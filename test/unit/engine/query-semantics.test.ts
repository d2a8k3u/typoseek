import { describe, expect, test } from 'vitest';
import type { Range, SearchOptions } from '../../../src/types.ts';
import { buildState, hitIds, searchRecords, searchState } from '../../support/engine.ts';

interface Dish {
  readonly id: number;
  readonly text: string;
}

const DISHES: readonly Dish[] = [
  { id: 1, text: 'red apple pie' },
  { id: 2, text: 'green apple tart' },
  { id: 3, text: 'red cherry pie' },
  { id: 4, text: 'apple red' },
  { id: 5, text: 'pineapple juice' },
  { id: 6, text: 'red applesauce' },
];

const WHOLE_RESULT = 1000;

const OPERATORS_ONLY: SearchOptions<Dish> = { typos: false, infix: false, limit: WHOLE_RESULT };

function rangeText([start, end]: Range): string {
  return `${String(start)}-${String(end)}`;
}

describe('FR-2 operators and each pair of them', () => {
  const state = buildState(DISHES, { keys: ['text'] });

  test.each([
    { operators: 'AND', query: 'red pie', mode: 'and', ids: [1, 3] },
    { operators: 'OR', query: 'cherry tart', mode: 'or', ids: [2, 3] },
    { operators: 'prefix', query: 'cher', mode: 'and', ids: [3] },
    { operators: 'phrase', query: '"apple pie"', mode: 'and', ids: [1] },
    { operators: 'phrase in order', query: '"red apple"', mode: 'and', ids: [1] },
    { operators: 'phrase of adjacent words', query: '"red pie"', mode: 'and', ids: [] },
    { operators: 'negation', query: '-red', mode: 'and', ids: [2, 5] },
    { operators: 'AND with prefix', query: 'red appl', mode: 'and', ids: [1, 4, 6] },
    { operators: 'AND with phrase', query: 'pie "red apple"', mode: 'and', ids: [1] },
    { operators: 'AND with negation', query: 'apple -red', mode: 'and', ids: [2] },
    { operators: 'OR with prefix', query: 'tart cher', mode: 'or', ids: [2, 3] },
    { operators: 'OR with phrase', query: 'juice "red cherry"', mode: 'or', ids: [3, 5] },
    { operators: 'OR with negation', query: 'tart pie -cherry', mode: 'or', ids: [1, 2] },
    { operators: 'prefix after a phrase', query: '"apple pie" re', mode: 'and', ids: [1] },
    { operators: 'no prefix before a closing phrase', query: 'appl "red apple"', mode: 'and', ids: [] },
    { operators: 'prefix after a negation', query: '-tart appl', mode: 'and', ids: [1, 4, 6] },
    { operators: 'no prefix before a closing negation', query: 'appl -tart', mode: 'and', ids: [] },
    { operators: 'negated phrase', query: 'apple -"red apple"', mode: 'and', ids: [2, 4] },
    { operators: 'negated phrase, not its words', query: 'red -"apple pie"', mode: 'and', ids: [3, 4, 6] },
    { operators: 'phrase with an unindexed word', query: '"apple zebra"', mode: 'and', ids: [] },
    { operators: 'negated phrase with an unindexed word', query: 'pie -"red zebra"', mode: 'and', ids: [1, 3] },
  ] as const)('$operators: $query', ({ query, mode, ids }) => {
    const response = searchState(state, query, { ...OPERATORS_ONLY, mode });

    expect(new Set(hitIds(response))).toEqual(new Set(ids));
  });

  test('a phrase with a single term matches that term exactly, without typos, prefix or infix', () => {
    expect(hitIds(searchState(state, '"appl"'))).toEqual([]);
  });
});

describe('FR-6 fold: false compares original tokens for every clause kind and highlights only those', () => {
  const state = buildState(
    [
      { id: 1, text: 'Café Crème' },
      { id: 2, text: 'cafe creme' },
      { id: 3, text: 'CAFÉ' },
      { id: 4, text: 'cafe Café' },
    ],
    { keys: ['text'] },
  );

  test.each<readonly [string, string, SearchOptions<Dish>, readonly string[]]>([
    ['an exact term', 'Café', {}, ['1: 0-4', '4: 5-9']],
    ['a prefix term', 'Caf', {}, ['1: 0-4', '4: 5-9']],
    ['an infix term', 'rème', {}, ['1: 5-10']],
    ['a fuzzy term', 'Cafés', { prefix: false }, ['1: 0-4', '4: 5-9']],
    ['two terms of one folded term', 'Café cafe', {}, ['4: 0-4 5-9']],
    ['a phrase', '"Café Crème"', {}, ['1: 0-4 5-10']],
    ['a negated phrase', '-"cafe creme"', {}, ['1: ', '3: ', '4: ']],
    ['a negated term', '-CAFÉ', {}, ['1: ', '2: ', '4: ']],
  ])('%s: %s', (_, query, options, hitsWithRanges) => {
    const response = searchState(state, query, { ...options, fold: false });

    expect(
      response.hits.map((hit) => {
        const ranges = hit.matches.flatMap((match) => match.ranges.map(rangeText));
        return `${String(hit.id)}: ${ranges.join(' ')}`;
      }),
    ).toEqual(hitsWithRanges);
  });
});

test('a stop word inside a phrase holds the place of any one token', () => {
  const records = [
    { id: 1, text: 'slice of pie' },
    { id: 2, text: 'slice pie' },
  ];

  const response = searchRecords(records, { keys: ['text'], stopWords: ['a'] }, '"slice a pie"');

  expect(hitIds(response)).toEqual([1]);
});

test('a phrase matches inside one value of one key path, never across values or key paths', () => {
  const records = [
    { id: 1, title: 'red', tags: ['cherry pie'] },
    { id: 2, title: 'plain', tags: ['red', 'cherry'] },
    { id: 3, title: 'plain', tags: ['red a cherry'] },
  ];

  const response = searchRecords(records, { keys: ['title', 'tags'], stopWords: ['a'] }, '"red a cherry"');

  expect(hitIds(response)).toEqual([3]);
});
