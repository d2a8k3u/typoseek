import { describe, expect, test } from 'vitest';
import { createIndex } from '../../../src/engine/create-index.ts';
import { search } from '../../../src/engine/one-shot.ts';
import type { IndexOptions, SearchIndex, Tokenizer } from '../../../src/types.ts';
import { searchRecords } from '../../support/engine.ts';

interface Note {
  readonly id: number | string;
  text: string;
}

const INVARIANT_VIOLATION_FOR_CHANGED_VALUE =
  /^typoseek invariant violated: .*the tokenizer is impure.*the record changed after indexing without update$/;

function typoseekError(code: string): unknown {
  return expect.objectContaining({ name: 'TyposeekError', code });
}

function noteIndex(options: Partial<IndexOptions<Note>> = {}): SearchIndex<Note> {
  return createIndex<Note>({ idKey: 'id', keys: ['text'], ...options });
}

const createUnchecked = createIndex as (options: unknown) => SearchIndex<Note>;

const searchUnchecked = search as (items: unknown, query: unknown, options?: unknown) => unknown;

type UncheckedIndex = Readonly<Record<keyof SearchIndex<Note>, (...args: unknown[]) => unknown>>;

function uncheckedIndex(index: SearchIndex<Note>): UncheckedIndex {
  return index as unknown as UncheckedIndex;
}

describe('front door input checks', () => {
  test.each([
    ['the index', (query: unknown) => uncheckedIndex(noteIndex()).search(query)],
    ['one-shot search', (query: unknown) => searchUnchecked(['fox'], query)],
  ])('rejects a non-string query through %s with INVALID_OPTION', (_, searchFor) => {
    expect(() => searchFor(7)).toThrow(typoseekError('INVALID_OPTION'));
    expect(() => searchFor(null)).toThrow(typoseekError('INVALID_OPTION'));
  });

  test('rejects records that are not an array in addAll by throwing and in addAllAsync by rejecting', async () => {
    const index = uncheckedIndex(noteIndex());
    const record = { id: 1, text: 'fox' };

    expect(() => index.addAll(record)).toThrow(typoseekError('INVALID_OPTION'));
    await expect(index.addAllAsync(record)).rejects.toEqual(typoseekError('INVALID_OPTION'));
    expect(noteIndex().size).toBe(0);
  });

  test.each([
    ['a non-iterable result', () => 7],
    ['a string result', (text: string) => text],
    ['a null span', () => [null]],
  ])('rejects a tokenizer that returns %s with INVALID_TOKEN_SPAN', (_, tokenize) => {
    const index = noteIndex({ tokenize: tokenize as unknown as Tokenizer });

    expect(() => {
      index.add({ id: 1, text: 'fox' });
    }).toThrow(typoseekError('INVALID_TOKEN_SPAN'));
    expect(index.size).toBe(0);
  });
});

describe('I6 a record edited in place after indexing', () => {
  test.each([
    ['an equal token count', 'red cat'],
    ['a different token count', 'red big fox'],
  ])(
    'with %s throws the invariant error naming both causes when highlighted, and update brings results back in line with a fresh index',
    (_, editedText) => {
      const records: Note[] = [
        { id: 1, text: 'red fox' },
        { id: 2, text: 'red owl' },
      ];
      const index = noteIndex();
      index.addAll(records);
      const [edited] = records;
      if (edited === undefined) {
        throw new Error('test fixture: the first record is missing');
      }

      edited.text = editedText;

      expect(() => index.search('red')).toThrow(INVARIANT_VIOLATION_FOR_CHANGED_VALUE);
      index.update(edited);
      for (const query of ['red', 'fox', 'cat big', '']) {
        expect(index.search(query)).toEqual(searchRecords(records, { keys: ['text'] }, query));
      }
    },
  );
});

describe('FR-17 hostile key paths and ids', () => {
  const index = noteIndex();
  index.add({ id: 1, text: 'fox' });

  test.each([
    ['an idKey __proto__', () => createUnchecked({ idKey: '__proto__', keys: ['text'] }), 'INVALID_OPTION'],
    [
      'a key path through __proto__',
      () => createUnchecked({ idKey: 'id', keys: ['__proto__.polluted'] }),
      'INVALID_OPTION',
    ],
    [
      'a key path through constructor.prototype',
      () => createUnchecked({ idKey: 'id', keys: ['constructor.prototype.polluted'] }),
      'INVALID_OPTION',
    ],
    ['a one-shot key path prototype', () => searchUnchecked([{}], 'fox', { keys: ['prototype'] }), 'INVALID_OPTION'],
    [
      'a filter key path through __proto__',
      () => uncheckedIndex(index).search('fox', { filter: { key: '__proto__.polluted', equals: true } }),
      'INVALID_OPTION',
    ],
    [
      'a sortBy key path constructor',
      () => uncheckedIndex(index).search('fox', { sortBy: { key: 'constructor' } }),
      'INVALID_OPTION',
    ],
    ['an added id __proto__', () => uncheckedIndex(index).add({ id: '__proto__', text: 'fox' }), 'INVALID_ID'],
    ['a removed id constructor', () => uncheckedIndex(index).remove('constructor'), 'INVALID_ID'],
  ])('rejects %s and leaves Object.prototype unchanged', (_, attempt, code) => {
    const prototypeKeys = Reflect.ownKeys(Object.prototype);

    expect(attempt).toThrow(typoseekError(code));
    expect(Reflect.ownKeys(Object.prototype)).toEqual(prototypeKeys);
    expect('polluted' in {}).toBe(false);
  });

  test('indexes a parsed record with an own __proto__ property as data and leaves Object.prototype unchanged', () => {
    const prototypeKeys = Reflect.ownKeys(Object.prototype);
    const hostile = JSON.parse('{"id": 2, "text": "owl", "__proto__": {"polluted": true}}') as Note;

    index.add(hostile);

    expect(index.search('owl').hits.map((hit) => hit.item)).toEqual([hostile]);
    expect(Reflect.ownKeys(Object.prototype)).toEqual(prototypeKeys);
    expect('polluted' in {}).toBe(false);
  });
});
