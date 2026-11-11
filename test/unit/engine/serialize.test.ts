import { describe, expect, test } from 'vitest';
import { foldTerm } from '../../../src/core/fold.ts';
import { FIELD_BREAK, VALUE_BREAK } from '../../../src/engine/state.ts';
import { createIndex } from '../../../src/index.ts';
import { loadIndex } from '../../../src/serialize.ts';
import type {
  LoadLimits,
  LoadOptions,
  SearchIndex,
  SerializedIndex,
  Tokenizer,
  TokenSpan,
} from '../../../src/types.ts';

interface Doc {
  readonly id: string;
  readonly title?: string;
  readonly subtitle?: string;
  readonly tags?: readonly string[];
}

const RED_FOX: Doc = { id: 'a', title: 'The Red fox', tags: ['den'] };

const FOX_TEXT = { title: 'fox', tags: ['fox', 'den'] } as const;

const FOX: Doc = { id: 'b', ...FOX_TEXT };

const BASE: SerializedIndex<Doc> = {
  format: 'typoseek-index',
  version: 1,
  idKey: 'id',
  keys: [
    { path: 'title', weight: 2 },
    { path: 'tags', weight: 1 },
  ],
  limits: { maxQueryLength: 256, maxQueryTerms: 16, maxExpansions: 50 },
  stopTerms: ['and', 'the'],
  surfaces: [
    ['The', null],
    ['Red', 'red'],
    ['fox', 'fox'],
    ['den', 'den'],
  ],
  records: [
    [RED_FOX, [2, 1, 0, 1, 2, FIELD_BREAK, 3]],
    [FOX, [1, 2, 2, FIELD_BREAK, 2, VALUE_BREAK, 3]],
  ],
};

const INVALID = 'INVALID_SERIALIZED_INDEX';

const QUERIES = ['', 'the', 'red', 'fox', 'red fox', 'fx', 'den', 'ow', '"red owl"', 'owl -den'];

const loadUnchecked = loadIndex as (data: unknown, options?: unknown) => SearchIndex<Doc>;

const NOT_ITERABLE_TOKENIZER = (() => 7) as unknown as Tokenizer;

function typoseekError(code: string, recordIndex?: number): unknown {
  return expect.objectContaining({ name: 'TyposeekError', code, recordIndex });
}

function viaJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function withRecord(recordIndex: number, record: unknown): unknown {
  return { ...BASE, records: BASE.records.map((listed, index) => (index === recordIndex ? record : listed)) };
}

function withItem(recordIndex: number, item: unknown): unknown {
  return withRecord(recordIndex, [item, BASE.records[recordIndex]?.[1]]);
}

function withStream(recordIndex: number, stream: unknown): unknown {
  return withRecord(recordIndex, [BASE.records[recordIndex]?.[0], stream]);
}

function withSurface(position: number, surface: unknown): unknown {
  return { ...BASE, surfaces: BASE.surfaces.map((listed, index) => (index === position ? surface : listed)) };
}

function expectSameSearches(loaded: SearchIndex<Doc>, original: SearchIndex<Doc>): void {
  for (const query of QUERIES) {
    expect(loaded.search(query)).toEqual(original.search(query));
  }
}

describe('loadIndex of a valid snapshot', () => {
  test('rebuilds a hand-written snapshot into an index that searches and serializes like one built from its records', () => {
    const built = createIndex<Doc>({
      idKey: 'id',
      keys: [{ path: 'title', weight: 2 }, 'tags'],
      stopWords: ['the', 'and'],
    });
    built.addAll([RED_FOX, FOX]);

    const loaded = loadIndex<Doc>(BASE);

    expectSameSearches(loaded, built);
    expect(loaded.toJSON()).toEqual(BASE);
  });

  test('round-trips records with an empty value, a punctuation-only value and a missing path through JSON', () => {
    const original = createIndex<Doc>({ idKey: 'id', keys: [{ path: 'title', weight: 2 }, 'subtitle', 'tags'] });
    original.addAll([
      { id: 'a', title: '', subtitle: 'Red fox' },
      { id: 'b', title: '!!!', tags: ['owl', ''] },
      { id: 'c', title: 'The red owl', subtitle: 'fox den', tags: ['night', 'red'] },
    ]);
    const snapshot = viaJson(original.toJSON());

    const loaded = loadIndex<Doc>(snapshot);

    expectSameSearches(loaded, original);
    expect(loaded.toJSON()).toEqual(snapshot);
  });

  test('takes stop terms and limits from the snapshot, so a load without them drops stop words and enforces the limits', () => {
    const original = createIndex<Doc>({
      idKey: 'id',
      keys: ['title'],
      stopWords: ['The'],
      limits: { maxQueryTerms: 2 },
    });
    original.addAll([
      { id: 'a', title: 'the fox' },
      { id: 'b', title: 'red owl' },
    ]);

    const loaded = loadIndex<Doc>(viaJson(original.toJSON()));

    expect(loaded.search('the').hits.map((hit) => hit.id)).toEqual(['a', 'b']);
    expect(loaded.search('red owl').total).toBe(1);
    expect(() => loaded.search('red owl fox')).toThrow(typoseekError('TOO_MANY_TERMS'));
  });

  test('keeps loaded record 0 intact and puts a record added after the load after every loaded one', () => {
    const loaded = loadIndex<Doc>(BASE);
    const redBefore = loaded.search('red');

    loaded.add({ id: 'c', title: 'red den' });

    expect(loaded.search('').hits.map((hit) => hit.id)).toEqual(['a', 'b', 'c']);
    const redAfter = loaded.search('red');
    expect(redAfter.hits[0]).toEqual(redBefore.hits[0]);
    expect(redAfter.hits[0]?.item).toBe(RED_FOX);
    expect(redAfter.hits.map((hit) => hit.id)).toEqual(['a', 'c']);
  });

  test('passes the normalizer and stemmer to the index without running them at load', () => {
    const calls: string[] = [];

    const loaded = loadIndex<Doc>(BASE, {
      normalize: (term) => {
        calls.push(`normalize ${term}`);
        return foldTerm(term);
      },
      stem: (term) => {
        calls.push(`stem ${term}`);
        return term;
      },
    });

    expect(calls).toEqual([]);
    expect(loaded.search('Fox').total).toBe(2);
    expect(calls).toEqual(['normalize Fox', 'stem fox']);
  });

  test.each([
    ['stopWords', { stopWords: ['the'] }],
    ['limits', { limits: { maxQueryTerms: 2 } }],
  ])('rejects %s, which the snapshot holds, with INVALID_OPTION', (_, options) => {
    expect(() => loadUnchecked(BASE, options)).toThrow(typoseekError('INVALID_OPTION'));
  });
});

describe('loadIndex rejects a snapshot with a typed error', () => {
  test.each<[string, unknown, string, number?]>([
    ['an array', [BASE], 'INVALID_SERIALIZED_INDEX'],
    ['another format', { ...BASE, format: 'other-index' }, 'INVALID_SERIALIZED_INDEX'],
    ['version 2', { ...BASE, version: 2 }, 'UNSUPPORTED_VERSION'],
    ['records that are not an array', { ...BASE, records: {} }, 'INVALID_SERIALIZED_INDEX'],
    ['surfaces that are not an array', { ...BASE, surfaces: 'The' }, 'INVALID_SERIALIZED_INDEX'],
    ['stopTerms that are not an array', { ...BASE, stopTerms: null }, 'INVALID_SERIALIZED_INDEX'],
    ['a record that is not an array', withRecord(1, FOX), 'INVALID_SERIALIZED_INDEX', 1],
    ['a record that is not a pair', withRecord(1, [FOX]), 'INVALID_SERIALIZED_INDEX', 1],
    ['a stream that is not an array', withStream(1, '1,2'), 'INVALID_SERIALIZED_INDEX', 1],
  ])('of the wrong version or shape: %s', (_, data, code, recordIndex) => {
    expect(() => loadIndex(data)).toThrow(typoseekError(code, recordIndex));
  });

  test.each<[string, Partial<LoadLimits>]>([
    ['records over maxRecords', { maxRecords: 1 }],
    ['surfaces over maxSurfaces', { maxSurfaces: 3 }],
    ['stop terms over maxStopTerms', { maxStopTerms: 1 }],
    ['stream slots over maxTokens', { maxTokens: 13 }],
  ])('that is oversized: %s', (_, loadLimits) => {
    expect(() => loadIndex(BASE, { loadLimits })).toThrow(typoseekError('SERIALIZED_INDEX_TOO_LARGE'));
  });

  test.each<[string, unknown]>([
    ['a forbidden idKey', { ...BASE, idKey: '__proto__' }],
    ['empty keys', { ...BASE, keys: [] }],
    ['limits that are not an object', { ...BASE, limits: null }],
    ['limits without maxExpansions', { ...BASE, limits: { maxQueryLength: 256, maxQueryTerms: 16 } }],
    ['limits with an extra key', { ...BASE, limits: { ...BASE.limits, maxTokens: 9 } }],
    ['limits out of range', { ...BASE, limits: { ...BASE.limits, maxExpansions: 0 } }],
  ])('with invalid options: %s', (_, data) => {
    expect(() => loadIndex(data)).toThrow(typoseekError('INVALID_SERIALIZED_INDEX'));
  });

  test.each<[string, unknown]>([
    ['a stop term that is not a string', { ...BASE, stopTerms: ['the', 7] }],
    ['an empty stop term', { ...BASE, stopTerms: ['the', ''] }],
    ['a repeated stop term', { ...BASE, stopTerms: ['the', 'the'] }],
    ['a surface that is not a pair', withSurface(2, ['fox'])],
    ['an empty surface', withSurface(2, ['', 'fox'])],
    ['a surface term that is not a string or null', withSurface(2, ['fox', 7])],
    ['an empty surface term', withSurface(2, ['fox', ''])],
    ['a repeated surface', withSurface(3, ['fox', 'fox'])],
  ])('with invalid stop terms or surfaces: %s', (_, data) => {
    expect(() => loadIndex(data)).toThrow(typoseekError('INVALID_SERIALIZED_INDEX'));
  });

  test.each<[string, unknown, number]>([
    ['an item that is null', withItem(0, null), 0],
    ['an id that is only inherited', withItem(1, Object.assign(Object.create({ id: 'b' }) as object, FOX_TEXT)), 1],
    ['a repeated id', withItem(1, { ...FOX, id: 'a' }), 1],
    ['a slot that is not an integer', withStream(1, [1, 2, 2.5, FIELD_BREAK, 2, VALUE_BREAK, 3]), 1],
    ['a stream shorter than its header', withStream(1, [1]), 1],
    ['a header that counts a stop surface', withStream(0, [3, 1, 0, 1, 2, FIELD_BREAK, 3]), 0],
    ['a surface index past the last surface', withStream(1, [1, 2, 4, FIELD_BREAK, 2, VALUE_BREAK, 3]), 1],
    ['a batch code', withStream(1, [1, 2, -3, FIELD_BREAK, 2, VALUE_BREAK, 3]), 1],
    ['a missing FIELD_BREAK', withStream(1, [1, 2, 2, VALUE_BREAK, 2, VALUE_BREAK, 3]), 1],
    ['an extra FIELD_BREAK', withStream(1, [1, 2, 2, FIELD_BREAK, 2, FIELD_BREAK, 3]), 1],
  ])('with an invalid record: %s', (_, data, recordIndex) => {
    expect(() => loadIndex(data)).toThrow(typoseekError('INVALID_SERIALIZED_INDEX', recordIndex));
  });

  test.each<[string, unknown, LoadOptions, string, number?]>([
    ['more tokens than slots', withItem(0, { ...RED_FOX, title: 'The Red fox den' }), {}, INVALID, 0],
    ['fewer tokens than slots', withItem(0, { ...RED_FOX, title: 'The Red' }), {}, INVALID, 0],
    ['a slot surface unlike its token text', withItem(0, { ...RED_FOX, title: 'The Red box' }), {}, INVALID, 0],
    ['more values than value runs', withItem(1, { ...FOX, tags: ['fox', 'den', 'owl'] }), {}, INVALID, 1],
    ['fewer values than value runs', withItem(1, { ...FOX, tags: ['fox'] }), {}, INVALID, 1],
    [
      'no values but a run with slots',
      withRecord(1, [{ id: 'b', title: 'fox' }, [1, 1, 2, FIELD_BREAK, 3]]),
      {},
      INVALID,
      1,
    ],
    [
      'no values but two runs',
      withRecord(1, [{ id: 'b', title: 'fox' }, [1, 0, 2, FIELD_BREAK, VALUE_BREAK]]),
      {},
      INVALID,
      1,
    ],
    ['a different tokenizer at load', BASE, { tokenize: (text) => [{ start: 0, end: text.length }] }, INVALID, 0],
    ['a tokenizer returning an empty span', BASE, { tokenize: () => [{ start: 0, end: 0 }] }, 'INVALID_TOKEN_SPAN'],
    ['a tokenizer returning a non-iterable', BASE, { tokenize: NOT_ITERABLE_TOKENIZER }, 'INVALID_TOKEN_SPAN'],
  ])('whose stream disagrees with its record text: %s', (_, data, options, code, recordIndex) => {
    expect(() => loadIndex(data, options)).toThrow(typoseekError(code, recordIndex));
  });

  test('reads at most one span past the slot count of a value from the tokenizer', () => {
    let spansRead = 0;
    function* everyCharacter(text: string): Generator<TokenSpan, undefined> {
      for (let start = 0; start < text.length; start += 1) {
        spansRead += 1;
        yield { start, end: start + 1 };
      }
      return undefined;
    }

    expect(() => loadIndex(BASE, { tokenize: everyCharacter })).toThrow(typoseekError(INVALID, 0));
    expect(spansRead).toBe(4);
  });

  test('with a surface no stream references', () => {
    const data = { ...BASE, surfaces: [...BASE.surfaces, ['owl', 'owl']] };

    expect(() => loadIndex(data)).toThrow(typoseekError(INVALID));
  });

  test.each<[string, unknown, LoadOptions, string, number?]>([
    [
      'version 2 before records over maxRecords',
      { ...BASE, version: 2 },
      { loadLimits: { maxRecords: 1 } },
      'UNSUPPORTED_VERSION',
    ],
    [
      'stream slots over maxTokens before a forbidden idKey',
      { ...BASE, idKey: '__proto__' },
      { loadLimits: { maxTokens: 13 } },
      'SERIALIZED_INDEX_TOO_LARGE',
    ],
    [
      'a repeated id in record 1 before a tokenizer the text of record 0 rejects',
      withItem(1, { ...FOX, id: 'a' }),
      { tokenize: () => [{ start: 0, end: 0 }] },
      INVALID,
      1,
    ],
    [
      'record text that disagrees with its stream before an unreferenced surface',
      { ...(withItem(0, { ...RED_FOX, title: 'The Red' }) as object), surfaces: [...BASE.surfaces, ['owl', 'owl']] },
      {},
      INVALID,
      0,
    ],
  ])('reporting the first failure in validation order: %s', (_, data, options, code, recordIndex) => {
    expect(() => loadIndex(data, options)).toThrow(typoseekError(code, recordIndex));
  });

  test('loads a snapshot exactly at every load limit', () => {
    const loaded = loadIndex(BASE, { loadLimits: { maxRecords: 2, maxSurfaces: 4, maxStopTerms: 2, maxTokens: 14 } });

    expect(loaded.size).toBe(2);
  });
});

describe('FR-17 hostile snapshot data', () => {
  const NON_SPACE = /\S+/g;

  const tokenizeOnSpaces: Tokenizer = (text) =>
    Array.from(text.matchAll(NON_SPACE), (match) => ({ start: match.index, end: match.index + match[0].length }));

  const HOSTILE_JSON = `{
    "__proto__": { "polluted": true },
    "format": "typoseek-index",
    "version": 1,
    "idKey": "id",
    "keys": [{ "path": "title", "weight": 1 }],
    "limits": { "maxQueryLength": 256, "maxQueryTerms": 16, "maxExpansions": 50 },
    "stopTerms": ["constructor"],
    "surfaces": [["__proto__", "__proto__"], ["constructor", null], ["prototype", "prototype"]],
    "records": [[{ "__proto__": { "polluted": true }, "id": "toString", "title": "__proto__ constructor prototype" }, [2, 0, 1, 2]]]
  }`;

  test('loads __proto__, constructor and prototype as plain data and leaves Object.prototype unchanged', () => {
    const before = Object.getOwnPropertyDescriptors(Object.prototype);
    const hostile = JSON.parse(HOSTILE_JSON) as unknown;

    const loaded = loadIndex(hostile, { tokenize: tokenizeOnSpaces });
    const rejected = [
      { ...(hostile as object), idKey: '__proto__' },
      { ...(hostile as object), keys: [{ path: '__proto__.polluted', weight: 1 }] },
    ].map((data) => () => loadIndex(data, { tokenize: tokenizeOnSpaces }));

    expect(loaded.search('__proto__').hits.map((hit) => hit.id)).toEqual(['toString']);
    for (const load of rejected) {
      expect(load).toThrow(typoseekError(INVALID));
    }
    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(before);
  });
});
