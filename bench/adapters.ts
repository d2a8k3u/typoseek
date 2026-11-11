import uFuzzy from '@leeoniya/ufuzzy';
import { create, insertMultiple, search as searchOrama } from '@orama/orama';
import { Charset, Document } from 'flexsearch';
import Fuse from 'fuse.js';
import fuzzysort from 'fuzzysort';
import MiniSearch from 'minisearch';
import { createIndex, foldTerm } from 'typoseek';
import type { BenchRecord } from './dataset.ts';

export interface Searcher {
  readonly search: (query: string) => number;
}

export interface LibraryAdapter {
  readonly name: string;
  readonly packageName: string;
  readonly settings: string;
  readonly build: (records: readonly BenchRecord[]) => Searcher;
}

const FIELDS = ['title', 'body', 'tag'] as const;

const RESULT_LIMIT = 20;

const MIN_LETTERS_FOR_ONE_TYPO = 4;

const MIN_LETTERS_FOR_TWO_TYPOS = 8;

const FUSE_ERRORS_PER_LETTER = 1 / MIN_LETTERS_FOR_ONE_TYPO;

const UFUZZY_PERMUTED_TERMS = 3;

const UFUZZY_INTRA_MODES: readonly number[] = [0, 1];

const UFUZZY_SINGLE_ERROR_MODE = 1;

function isIntraMode(mode: number): mode is uFuzzy.IntraMode {
  return UFUZZY_INTRA_MODES.includes(mode);
}

function intraMode(mode: number): uFuzzy.IntraMode {
  if (!isIntraMode(mode)) {
    throw new RangeError(`uFuzzy has no intraMode ${String(mode)}`);
  }
  return mode;
}

const QUERY_TERM_SEPARATOR = ' ';

function typoBudget(term: string): number {
  const letters = Array.from(term).length;
  if (letters >= MIN_LETTERS_FOR_TWO_TYPOS) {
    return 2;
  }
  return letters >= MIN_LETTERS_FOR_ONE_TYPO ? 1 : 0;
}

function largestTypoBudget(query: string): number {
  return Math.max(0, ...query.split(QUERY_TERM_SEPARATOR).map(typoBudget));
}

function recordText(record: BenchRecord): string {
  return FIELDS.map((field) => record[field]).join(' ');
}

const typoseek: LibraryAdapter = {
  name: 'typoseek',
  packageName: 'typoseek',
  settings:
    'defaults: AND of all terms, 1 typo (OSA) from 4 and 2 typos from 8 code points, prefix and infix on the last term, diacritic folding, highlights, limit 20',
  build: (records) => {
    const index = createIndex<BenchRecord>({ idKey: 'id', keys: [...FIELDS] });
    index.addAll(records);
    return { search: (query) => index.search(query).hits.length };
  },
};

const miniSearch: LibraryAdapter = {
  name: 'MiniSearch',
  packageName: 'minisearch',
  settings:
    'combineWith AND, fuzzy 1 edit (Levenshtein) from 4 and 2 edits from 8 letters, prefix on the last term, processTerm foldTerm from typoseek, first 20 results',
  build: (records) => {
    const index = new MiniSearch<BenchRecord>({
      fields: [...FIELDS],
      processTerm: foldTerm,
      searchOptions: {
        combineWith: 'AND',
        fuzzy: (term) => typoBudget(term) || false,
        prefix: (_, position, terms) => position === terms.length - 1,
      },
    });
    index.addAll(records);
    return { search: (query) => index.search(query).slice(0, RESULT_LIMIT).length };
  },
};

const fuse: LibraryAdapter = {
  name: 'Fuse',
  packageName: 'fuse.js',
  settings:
    'useTokenSearch with tokenMatch all, threshold 0.25 (1 error per 4 letters), ignoreLocation, ignoreDiacritics, limit 20',
  build: (records) => {
    const index = new Fuse(records, {
      keys: [...FIELDS],
      useTokenSearch: true,
      tokenMatch: 'all',
      threshold: FUSE_ERRORS_PER_LETTER,
      ignoreLocation: true,
      ignoreDiacritics: true,
    });
    return { search: (query) => index.search(query, { limit: RESULT_LIMIT }).length };
  },
};

const orama: LibraryAdapter = {
  name: 'Orama',
  packageName: '@orama/orama',
  settings:
    'threshold 0 (all terms), tolerance per query = the largest typo budget of its terms (1 from 4, 2 from 8 letters), default prefix matching and diacritic replacement, limit 20',
  build: (records) => {
    const db = create({ schema: { title: 'string', body: 'string', tag: 'string' } as const });
    const inserted = insertMultiple(db, [...records]);
    if (inserted instanceof Promise) {
      throw new TypeError('Orama inserted asynchronously; the adapter measures its synchronous path');
    }
    return {
      search: (query) => {
        const result = searchOrama(db, {
          term: query,
          properties: [...FIELDS],
          tolerance: largestTypoBudget(query),
          threshold: 0,
          limit: RESULT_LIMIT,
        });
        if (result instanceof Promise) {
          throw new TypeError('Orama searched asynchronously; the adapter measures its synchronous path');
        }
        return result.hits.length;
      },
    };
  },
};

const flexSearch: LibraryAdapter = {
  name: 'FlexSearch',
  packageName: 'flexsearch',
  settings:
    'Document over one field joining title, body and tag (FlexSearch matches all query terms within one field), tokenize forward (prefix), encoder LatinBalance (diacritic and phonetic normalization, no edit distance), limit 20',
  build: (records) => {
    const index = new Document<{ readonly id: string; readonly text: string }>({
      document: { id: 'id', index: ['text'] },
      tokenize: 'forward',
      encoder: Charset.LatinBalance,
    });
    for (const record of records) {
      index.add({ id: record.id, text: recordText(record) });
    }
    return { search: (query) => index.search(query, { limit: RESULT_LIMIT, merge: true }).length };
  },
};

const fuzzySort: LibraryAdapter = {
  name: 'fuzzysort',
  packageName: 'fuzzysort',
  settings:
    'snapshot of the three keys, subsequence matching per space-separated term (no edit distance), default threshold, limit 20',
  build: (records) => {
    const targets = fuzzysort.snapshot(records, { keys: [...FIELDS] });
    return { search: (query) => fuzzysort.go(query, targets, { limit: RESULT_LIMIT }).length };
  },
};

const microFuzzy: LibraryAdapter = {
  name: 'uFuzzy',
  packageName: '@leeoniya/ufuzzy',
  settings:
    'intraMode SingleError (1 insertion, substitution, transposition or deletion per term), terms in any order (up to 3 permuted), latinized haystack and needle, ranked only when at most 1,000 records match (default infoThresh), first 20 results',
  build: (records) => {
    const finder = new uFuzzy({
      intraMode: intraMode(UFUZZY_SINGLE_ERROR_MODE),
      intraIns: 1,
      intraSub: 1,
      intraTrn: 1,
      intraDel: 1,
    });
    const haystack = uFuzzy.latinize(records.map(recordText));
    return {
      search: (query) => {
        const [matched] = finder.search(haystack, uFuzzy.latinize(query), UFUZZY_PERMUTED_TERMS);
        return Math.min(matched?.length ?? 0, RESULT_LIMIT);
      },
    };
  },
};

export const ADAPTERS: readonly LibraryAdapter[] = [
  typoseek,
  miniSearch,
  fuse,
  orama,
  flexSearch,
  fuzzySort,
  microFuzzy,
];
