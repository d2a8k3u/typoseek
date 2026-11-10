import { describe, expect, test } from 'vitest';
import type { FieldMatch, SearchOptions } from '../../../src/types.ts';
import { buildState, searchRecords, searchState } from '../../support/engine.ts';

interface Doc {
  readonly id: number;
  readonly text: string;
}

const TEXT_KEY = { keys: ['text'] } as const;

function matchesOf(records: readonly Doc[], query: string, options: SearchOptions<Doc> = {}) {
  return searchRecords(records, TEXT_KEY, query, options).hits.map((hit) => [hit.id, hit.matches]);
}

function textRanges(...ranges: readonly (readonly [number, number])[]): readonly FieldMatch[] {
  return [{ key: 'text', valueIndex: 0, ranges }];
}

describe('FR-5 highlight ranges', () => {
  test.each([
    ['after astral characters', '𝐀𝐁 Café', [5, 9]],
    ['over a combining mark', '𝐀𝐁 Café', [5, 10]],
    ['in upper case', 'ab CAFE', [3, 7]],
  ] as const)('are whole-token UTF-16 offsets into the original value %s', (_, text, range) => {
    expect(matchesOf([{ id: 1, text }], 'cafe')).toEqual([[1, textRanges(range)]]);
  });

  test('cover the whole token of prefix and infix matches', () => {
    expect(matchesOf([{ id: 1, text: 'catalog cats bobcat dog' }], 'cat')).toEqual([
      [1, textRanges([0, 7], [8, 12], [13, 19])],
    ]);
  });

  test('are grouped by key path in options order, then by value index', () => {
    const record = { id: 1, tags: ['red', 'green', 'blue red'], meta: { year: 2024 }, title: 'red' };

    const response = searchRecords([record], { keys: ['title', 'tags', 'meta.year'] }, 'red 2024');

    expect(response.hits[0]?.matches).toEqual([
      { key: 'title', valueIndex: 0, ranges: [[0, 3]] },
      { key: 'tags', valueIndex: 0, ranges: [[0, 3]] },
      { key: 'tags', valueIndex: 2, ranges: [[5, 8]] },
      { key: 'meta.year', valueIndex: 0, ranges: [[0, 4]] },
    ]);
  });

  test('mark every occurrence of a phrase term in a record the phrase matched, and none elsewhere', () => {
    const records = [
      { id: 1, text: 'red cherry red' },
      { id: 2, text: 'red apple juice' },
    ];

    expect(matchesOf(records, 'juice "red cherry"', { mode: 'or' })).toEqual([
      [1, textRanges([0, 3], [4, 10], [11, 14])],
      [2, textRanges([10, 15])],
    ]);
  });

  test('never mark the terms of a negated clause', () => {
    expect(matchesOf([{ id: 1, text: 'red wine' }], 'red -"wine red"')).toEqual([[1, textRanges([0, 3])]]);
  });
});

describe('highlighting a record edited in place after indexing', () => {
  const BOTH_CAUSES = /^typoseek invariant violated: .*tokenizer.*update/;

  test.each([
    ['an equal token count', (tags: string[]) => tags.splice(1, 1, 'red grape')],
    ['a different token count', (tags: string[]) => tags.splice(1, 1, 'red big apple')],
    ['the matched value removed', (tags: string[]) => tags.splice(1, 1)],
  ])('with %s throws the invariant error naming both causes', (_, edit) => {
    const record = { id: 1, tags: ['blue', 'red apple'] };
    const state = buildState([record], { keys: ['tags'] });

    edit(record.tags);

    expect(() => searchState(state, 'red')).toThrow(BOTH_CAUSES);
  });
});
