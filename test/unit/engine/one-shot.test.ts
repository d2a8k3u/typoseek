import { describe, expect, test } from 'vitest';
import { search } from '../../../src/engine/one-shot.ts';
import type { ArrayHit, SearchResponse } from '../../../src/types.ts';

interface Card {
  readonly title: string;
  readonly tags?: readonly string[];
}

const searchUnchecked = search as (items: unknown, query: unknown, options?: unknown) => unknown;

function typoseekError(code: string, recordIndex?: number): unknown {
  return expect.objectContaining({ name: 'TyposeekError', code, recordIndex });
}

function refIndexes(response: SearchResponse<ArrayHit<unknown>>): readonly number[] {
  return response.hits.map((hit) => hit.refIndex);
}

describe('FR-11 one-shot search', () => {
  test("searches string items as the single value of key path '' and reports each hit by its position", () => {
    expect(search(['red fox', 'cat', 'fox den'], 'fox')).toEqual({
      total: 2,
      hits: [
        { refIndex: 0, item: 'red fox', matches: [{ key: '', valueIndex: 0, ranges: [[4, 7]] }] },
        { refIndex: 2, item: 'fox den', matches: [{ key: '', valueIndex: 0, ranges: [[0, 3]] }] },
      ],
    });
  });

  test('searches object items through their keys and returns each item by reference', () => {
    const items: readonly Card[] = [{ title: 'cat' }, { title: 'red fox', tags: ['den'] }];

    const response = search(items, 'fox', { keys: ['title', 'tags'] });

    expect(response).toEqual({
      total: 1,
      hits: [{ refIndex: 1, item: items[1], matches: [{ key: 'title', valueIndex: 0, ranges: [[4, 7]] }] }],
    });
    expect(response.hits[0]?.item).toBe(items[1]);
  });

  test.each([
    ['a non-string among string items', ['fox', 7], undefined],
    ['a string among object items', [{ title: 'fox' }, 'fox'], { keys: ['title'] }],
  ])('rejects %s as INVALID_RECORD at its position', (_, items, options) => {
    expect(() => searchUnchecked(items, 'fox', options)).toThrow(typoseekError('INVALID_RECORD', 1));
  });

  test.each([
    ['items that are not an array', 'fox', undefined],
    ['options that are null', ['fox'], null],
    ['a key filter on string items', ['fox'], { filter: { key: 'length', equals: 3 } }],
    ['a key filter in a filter list on string items', ['fox'], { filter: [() => true, { key: 'length', equals: 3 }] }],
    ['a sortBy on string items', ['fox'], { sortBy: { key: 'length' } }],
  ])('rejects %s with INVALID_OPTION', (_, items, options) => {
    expect(() => searchUnchecked(items, 'fox', options)).toThrow(typoseekError('INVALID_OPTION'));
  });

  test('applies a list of predicate filters to string items', () => {
    const filter = [(item: string) => item !== 'fox den', (item: string) => item.length > 3];

    expect(refIndexes(search(['fox', 'fox den', 'red fox'], 'fox', { filter }))).toEqual([2]);
  });

  test('resolves stop words and limits as an index does', () => {
    expect(refIndexes(search(['cat', 'fox'], 'fox', { stopWords: ['fox'] }))).toEqual([0, 1]);
    expect(() => search(['fox'], 'fox', { limits: { maxQueryLength: 2 } })).toThrow(typoseekError('QUERY_TOO_LONG'));
  });
});
