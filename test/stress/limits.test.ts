import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { generateDataset, type BenchRecord, type Dataset } from '../../bench/dataset.ts';
import { generateQueries } from '../../bench/queries.ts';
import { itemAt, mulberry32 } from '../../bench/random.ts';
import { expandTerm, INFIX_SCAN_PER_EXPANSION } from '../../src/core/expand.ts';
import { DEFAULT_LIMITS } from '../../src/core/options.ts';
import { compareTermRank } from '../../src/core/radix-tree.ts';
import { createIndex, type SearchIndex, type SearchOptions } from '../../src/index.ts';
import { loadIndex } from '../../src/serialize.ts';
import type { SerializedIndex } from '../../src/types.ts';

vi.mock(import('../../src/core/expand.ts'), async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, expandTerm: vi.fn(original.expandTerm) as typeof original.expandTerm };
});

const SEED = 20261110;

const STRESS_RECORD_COUNT = 100_000;

const NFR_2_P95_MS = 50;

const ADVERSARIAL_BOUND_MS = NFR_2_P95_MS * 10;

const GRAM_UPKEEP_BOUND_MS = 2_000;

const SINGLE_RECORD_UPKEEP_BOUND_MS = 4_000;

const STRESS_TIMEOUT_MS = 120_000;

const MAX_EXPANSIONS_CAP = 1_000;

const OR_AT_LIMIT_CAP: SearchOptions<BenchRecord> = { mode: 'or', limit: 1_000 };

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

const INFIX_QUERY = 'wxyz';

const INFIX_GROUP_SIZE = INFIX_SCAN_PER_EXPANSION * MAX_EXPANSIONS_CAP;

const INFIX_GROUP_STEM = `a${INFIX_QUERY.slice(0, 3)}a${INFIX_QUERY.slice(1)}`;

const LETTERS_WITHOUT_INFIX_QUERY = 'abcdefghijklmnopqrstuv';

const ADVERSARIAL_TOKEN_LETTERS = 4_096;

const SHARED_GRAM_TERM_COUNT = 200_000;

const MAX_ARRAY_LENGTH = 2 ** 32 - 1;

const SERIALIZED_INDEX_TOO_LARGE: unknown = expect.objectContaining({
  name: 'TyposeekError',
  code: 'SERIALIZED_INDEX_TOO_LARGE',
});

function elapsedMs(run: () => unknown): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

function timedRejection(run: () => unknown): { readonly ms: number; readonly error: unknown } {
  const start = performance.now();
  try {
    run();
  } catch (error: unknown) {
    return { ms: performance.now() - start, error };
  }
  throw new Error('the load was expected to throw');
}

function lettersOf(value: number, alphabet: string, width: number): string {
  let rest = value;
  let letters = '';
  for (let position = 0; position < width; position += 1) {
    letters = itemAt(alphabet, rest % alphabet.length) + letters;
    rest = Math.floor(rest / alphabet.length);
  }
  return letters;
}

function sparseArray(length: number): string[] {
  const array: string[] = [];
  array.length = length;
  return array;
}

function nestedQuotesAndBrackets(length: number): string {
  const opening = '(["';
  const depth = Math.floor(length / (opening.length * 2));
  return opening.repeat(depth) + '"])'.repeat(depth);
}

function filledTo(terms: readonly string[], length: number): string {
  return terms.join(' ').padEnd(length);
}

function twoEditTerms(dataset: Dataset, count: number): readonly string[] {
  const terms = generateQueries(dataset, { seed: SEED, count: 1_000 })
    .flatMap((query) => query.terms)
    .filter((term) => term.kind === 'twoEdits')
    .map((term) => term.text)
    .slice(0, count);
  if (terms.length < count) {
    throw new RangeError(`the query mix holds fewer than ${String(count)} two-edit terms`);
  }
  return terms;
}

function longTerms(terms: readonly string[], queryLength: number): readonly string[] {
  const letters = queryLength - (terms.length - 1);
  const baseLength = Math.floor(letters / terms.length);
  const longer = letters % terms.length;
  return terms.map((term, position) =>
    term.repeat(3).slice(0, baseLength + (position >= terms.length - longer ? 1 : 0)),
  );
}

function infixGroup(): readonly BenchRecord[] {
  return Array.from({ length: INFIX_GROUP_SIZE }, (_, index) => ({
    id: `infix-${String(index)}`,
    title: `${INFIX_GROUP_STEM}${lettersOf(index, LETTERS_WITHOUT_INFIX_QUERY, 4)}`,
    body: '',
    tag: '',
  }));
}

function seededLetters(length: number): string {
  const random = mulberry32(SEED);
  return Array.from({ length }, () => itemAt(LETTERS, Math.floor(random() * LETTERS.length))).join('');
}

function adversarialRecord(title: string, body = '', tag = ''): BenchRecord {
  return { id: 'adversarial', title, body, tag };
}

function adversarialRecords(): readonly (readonly [name: string, record: BenchRecord])[] {
  const longToken = seededLetters(ADVERSARIAL_TOKEN_LETTERS);
  return [
    [
      'repeats, nested brackets and quotes and dash runs',
      adversarialRecord(
        `${'a'.repeat(DEFAULT_LIMITS.maxQueryLength)} ${'(["'.repeat(1_000)}`,
        '-'.repeat(10_000),
        '"'.repeat(1_000),
      ),
    ],
    ['one 4,096-letter token', adversarialRecord(longToken)],
    [
      '26 tokens of one shared 4,096-letter prefix plus a letter',
      adversarialRecord(Array.from(LETTERS, (letter) => `${longToken}${letter}`).join(' ')),
    ],
  ];
}

describe(
  'a 100,000-record index answers every query at its caps and every adversarial input within NFR-2 × 10',
  {
    timeout: STRESS_TIMEOUT_MS,
  },
  () => {
    let built: SearchIndex<BenchRecord> | undefined;
    let capQueries: readonly (readonly [name: string, query: string])[];
    let adversarialInputs: readonly (readonly [name: string, query: string])[];

    const stressIndex = (): SearchIndex<BenchRecord> => {
      if (built === undefined) {
        throw new Error('the stress index is built before the tests and released after them');
      }
      return built;
    };

    beforeAll(() => {
      const dataset = generateDataset({ seed: SEED, size: STRESS_RECORD_COUNT });
      const index = createIndex<BenchRecord>({
        idKey: 'id',
        keys: ['title', 'body', 'tag'],
        limits: { maxExpansions: MAX_EXPANSIONS_CAP },
      });
      index.addAll(dataset.records);
      index.addAll(infixGroup());
      built = index;
      const { maxQueryLength, maxQueryTerms } = DEFAULT_LIMITS;
      const typoTerms = twoEditTerms(dataset, maxQueryTerms);
      const frequentWords = dataset.vocabulary.slice(0, maxQueryTerms);
      const shortPrefix = Array.from(itemAt(frequentWords, 0)).slice(0, 3).join('');
      capQueries = [
        ['16 two-edit terms in 256 code points', filledTo(typoTerms, maxQueryLength)],
        ['16 terms longer than any indexed term in 256 code points', longTerms(typoTerms, maxQueryLength).join(' ')],
        [
          '15 two-edit terms and a 3-letter prefix and infix last term in 256 code points',
          filledTo([...typoTerms.slice(1), shortPrefix], maxQueryLength),
        ],
      ];
      adversarialInputs = [
        ['256 repeated characters', 'a'.repeat(maxQueryLength)],
        ['nested quotes and brackets', nestedQuotesAndBrackets(maxQueryLength)],
        [
          'quoted and bracketed frequent words',
          frequentWords
            .map((word) => `"([${word}])"`)
            .join(' ')
            .slice(0, maxQueryLength),
        ],
        ['one phrase of 16 frequent words', `"${frequentWords.join(' ')}"`.slice(0, maxQueryLength)],
        ['a dash run', '-'.repeat(maxQueryLength)],
        ['16 negated frequent words', frequentWords.map((word) => `-${word}`).join(' ')],
        ['a single-character prefix', 'a'],
      ];
    }, STRESS_TIMEOUT_MS);

    afterAll(() => {
      built = undefined;
    });

    test.each([
      ['default options', {}],
      ['or mode at the limit cap of 1,000', OR_AT_LIMIT_CAP],
    ] as const)('parses and searches every query at its caps with %s under 500 ms', (_, options) => {
      const index = stressIndex();
      const times = capQueries.map(([name, query]) => [name, elapsedMs(() => index.search(query, options))] as const);

      expect(times.filter(([, ms]) => ms >= ADVERSARIAL_BOUND_MS)).toEqual([]);
    });

    test.each([
      ['default options', {}],
      ['or mode at the limit cap of 1,000', OR_AT_LIMIT_CAP],
    ] as const)('parses and searches every adversarial input with %s under 500 ms', (_, options) => {
      const index = stressIndex();
      const times = adversarialInputs.map(
        ([name, query]) => [name, elapsedMs(() => index.search(query, options))] as const,
      );

      expect(times.filter(([, ms]) => ms >= ADVERSARIAL_BOUND_MS)).toEqual([]);
    });

    test('checks a last term whose grams all sit in 20,000 added terms that do not hold it up to the window of maxExpansions 1,000, under 500 ms', () => {
      const index = stressIndex();
      const expand = vi.mocked(expandTerm);
      expand.mockClear();
      const ms = elapsedMs(() => index.search(INFIX_QUERY));
      const infixChecks = expand.mock.results.map((result) =>
        result.type === 'return' ? result.value.infixChecks : 0,
      );

      expect(infixChecks).toEqual([INFIX_GROUP_SIZE]);
      expect(ms).toBeLessThan(ADVERSARIAL_BOUND_MS);
    });

    test.each(adversarialRecords())(
      'indexes and removes an adversarial record of %s, each under 500 ms',
      (_, adversarial) => {
        const index = stressIndex();

        const addMs = elapsedMs(() => {
          index.add(adversarial);
        });
        const removeMs = elapsedMs(() => {
          index.remove(adversarial.id);
        });

        expect.soft(addMs).toBeLessThan(ADVERSARIAL_BOUND_MS);
        expect.soft(removeMs).toBeLessThan(ADVERSARIAL_BOUND_MS);
      },
    );
  },
);

interface WordRecord {
  readonly id: number;
  readonly word: string;
}

function sharedGramRecords(): readonly WordRecord[] {
  return Array.from(
    { length: SHARED_GRAM_TERM_COUNT },
    (_, index) =>
      `${itemAt(LETTERS, index % LETTERS.length)}abc${lettersOf(Math.floor(index / LETTERS.length), LETTERS, 3)}`,
  )
    .sort((a, b) => compareTermRank(b, a))
    .map((word, id) => ({ id, word }));
}

function emptyWordIndex(): SearchIndex<WordRecord> {
  return createIndex<WordRecord>({ idKey: 'id', keys: ['word'] });
}

function seededShuffle<T>(items: readonly T[]): readonly T[] {
  const random = mulberry32(SEED);
  const shuffled = [...items];
  for (let last = shuffled.length - 1; last > 0; last -= 1) {
    const swap = Math.floor(random() * (last + 1));
    const kept = itemAt(shuffled, last);
    shuffled[last] = itemAt(shuffled, swap);
    shuffled[swap] = kept;
  }
  return shuffled;
}

describe(
  'gram upkeep of 200,000 distinct terms that all hold the gram abc at code point offset 1, in descending term rank',
  {
    timeout: STRESS_TIMEOUT_MS,
  },
  () => {
    let records: readonly WordRecord[];

    beforeAll(() => {
      records = sharedGramRecords();
    });

    test('addAll into an empty index runs under 2 s', () => {
      const index = emptyWordIndex();

      const ms = elapsedMs(() => {
        index.addAll(records);
      });

      expect(index.size).toBe(SHARED_GRAM_TERM_COUNT);
      expect(ms).toBeLessThan(GRAM_UPKEEP_BOUND_MS);
    });

    test("loadIndex of that index's snapshot runs under 2 s", () => {
      const index = emptyWordIndex();
      index.addAll(records);
      const snapshot = index.toJSON();
      let loaded: SearchIndex<WordRecord> | undefined;

      const ms = elapsedMs(() => {
        loaded = loadIndex<WordRecord>(snapshot);
      });

      expect(loaded?.size).toBe(SHARED_GRAM_TERM_COUNT);
      expect(ms).toBeLessThan(GRAM_UPKEEP_BOUND_MS);
    });

    test('200,000 single add calls into an empty index, then 200,000 single remove calls in a seeded random order, each run under 4 s', () => {
      const index = emptyWordIndex();
      const removalOrder = seededShuffle(records.map((record) => record.id));

      const addMs = elapsedMs(() => {
        for (const record of records) {
          index.add(record);
        }
      });
      const removeMs = elapsedMs(() => {
        for (const id of removalOrder) {
          index.remove(id);
        }
      });

      expect(index.size).toBe(0);
      expect.soft(addMs).toBeLessThan(SINGLE_RECORD_UPKEEP_BOUND_MS);
      expect.soft(removeMs).toBeLessThan(SINGLE_RECORD_UPKEEP_BOUND_MS);
    });
  },
);

interface TaggedDoc {
  readonly id: string;
  readonly title: string;
  readonly tags: readonly string[];
}

interface SharedTextDoc {
  readonly id: string;
  readonly body: { readonly text: string };
}

interface KeyPathDoc {
  readonly id: string;
  readonly a: readonly Readonly<Record<string, string>>[];
}

const SHARED_TEXT_LENGTH = 1_000_000;

const SHARING_RECORD_COUNT = 1_000;

const CHARGED_SHARED_COPIES = 10;

const KEY_PATH_COUNT = 1_000;

const SLOT_COUNT = 100_000;

const CHARGED_KEY_PATHS = 100;

const HOLE_SLOTS = 2 ** 24;

const HELD_TAGS = ['fox', 'den', 'owl'] as const;

function taggedSnapshot(): SerializedIndex<TaggedDoc> {
  const index = createIndex<TaggedDoc>({ idKey: 'id', keys: ['title', 'tags'] });
  index.add({ id: 'a', title: 'fox', tags: HELD_TAGS });
  return index.toJSON();
}

function withTags(tags: readonly string[]): unknown {
  const snapshot = taggedSnapshot();
  return {
    ...snapshot,
    records: snapshot.records.map(([item, stream]) => [{ ...item, tags }, stream] as const),
  };
}

describe(
  'hostile snapshots meet LoadLimits.maxTextLength on the real loadIndex',
  { timeout: STRESS_TIMEOUT_MS },
  () => {
    test('rejects a cloned snapshot holding a sparse array of length 2^32 - 1 at a key path, at the default limits, under 500 ms', () => {
      const hostile = structuredClone(withTags(sparseArray(MAX_ARRAY_LENGTH)));

      const { ms, error } = timedRejection(() => loadIndex(hostile));

      expect(error).toEqual(SERIALIZED_INDEX_TOO_LARGE);
      expect(ms).toBeLessThan(ADVERSARIAL_BOUND_MS);
    });

    test('rejects a cloned snapshot of 1,000 records sharing one 1,000,000-code-unit value below records × value length, under 500 ms', () => {
      const sharedText = `${'-'.repeat(SHARED_TEXT_LENGTH - ' fox'.length)} fox`;
      const index = createIndex<SharedTextDoc>({ idKey: 'id', keys: ['body.text'] });
      index.add({ id: 'r0', body: { text: sharedText } });
      const snapshot = index.toJSON();
      const [, stream] = itemAt(snapshot.records, 0);
      const shared = { text: sharedText };
      const hostile = structuredClone({
        ...snapshot,
        records: Array.from({ length: SHARING_RECORD_COUNT }, (_, recordIndex) => [
          { id: `r${String(recordIndex)}`, body: shared },
          stream,
        ]),
      });

      const { ms, error } = timedRejection(() =>
        loadIndex(hostile, { loadLimits: { maxTextLength: SHARED_TEXT_LENGTH * CHARGED_SHARED_COPIES } }),
      );

      expect(error).toEqual(SERIALIZED_INDEX_TOO_LARGE);
      expect(ms).toBeLessThan(ADVERSARIAL_BOUND_MS);
    });

    test('rejects a JSON snapshot of 1,000 key paths a.k0 to a.k999 over one 100,000-slot array below 1,000 × 100,000, under 500 ms', () => {
      const keys = Array.from({ length: KEY_PATH_COUNT }, (_, keyIndex) => `a.k${String(keyIndex)}` as const);
      const index = createIndex<KeyPathDoc>({ idKey: 'id', keys });
      index.add({ id: 'a', a: [] });
      const snapshot = index.toJSON();
      const hostile: unknown = JSON.parse(
        JSON.stringify({
          ...snapshot,
          records: snapshot.records.map(([item, stream]) => [
            { ...item, a: new Array<number>(SLOT_COUNT).fill(0) },
            stream,
          ]),
        }),
      );

      const { ms, error } = timedRejection(() =>
        loadIndex(hostile, { loadLimits: { maxTextLength: SLOT_COUNT * CHARGED_KEY_PATHS } }),
      );

      expect(error).toEqual(SERIALIZED_INDEX_TOO_LARGE);
      expect(ms).toBeLessThan(ADVERSARIAL_BOUND_MS);
    });

    test('loads a cloned snapshot whose one array holds 2^24 own-index holes and a handful of text values at a maxTextLength of 2^24 plus the text lengths, under 2 s', () => {
      const tags = sparseArray(HOLE_SLOTS);
      tags[0] = 'fox';
      tags[HOLE_SLOTS / 2] = 'den';
      tags[HOLE_SLOTS - 1] = 'owl';
      const hostile = structuredClone(withTags(tags));
      const textLength = 'fox'.length + HELD_TAGS.join('').length;
      let loaded: SearchIndex<TaggedDoc> | undefined;

      const ms = elapsedMs(() => {
        loaded = loadIndex<TaggedDoc>(hostile, { loadLimits: { maxTextLength: HOLE_SLOTS + textLength } });
      });

      expect(loaded?.size).toBe(1);
      expect(ms).toBeLessThan(GRAM_UPKEEP_BOUND_MS);
    });
  },
);
