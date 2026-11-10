import { describe, expect, test } from 'vitest';
import { DEFAULT_LIMITS } from '../../../src/core/options.ts';
import type { Limits } from '../../../src/types.ts';
import { buildState, hitIds, searchRecords, searchState } from '../../support/engine.ts';

const RECORDS = [
  { id: 1, text: 'cat' },
  { id: 2, text: 'cat zebra' },
];

const STOP_WORD = 'the';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

const ENGINE_OPTIONS = { keys: ['text'], stopWords: [STOP_WORD] } as const;

const CUSTOM_LIMITS: Limits = { maxQueryLength: 24, maxQueryTerms: 3, maxExpansions: 3 };

const LIMIT_SETTINGS = [
  ['the default limits', undefined, DEFAULT_LIMITS],
  ['custom limits', CUSTOM_LIMITS, CUSTOM_LIMITS],
] as const;

function queryOfCodePoints(length: number): string {
  return `cat${' '.repeat(length - 4)}z`;
}

function queryOfTokens(count: number): string {
  return [...Array.from({ length: count - 2 }, () => 'cat'), STOP_WORD, 'zebra'].join(' ');
}

describe.each(LIMIT_SETTINGS)('FR-16 query caps with %s', (_, limits, caps) => {
  const state = buildState(RECORDS, { ...ENGINE_OPTIONS, ...(limits === undefined ? {} : { limits }) });

  test.each([
    ['maxQueryLength code points', queryOfCodePoints, caps.maxQueryLength, 'QUERY_TOO_LONG'],
    ['maxQueryTerms tokens, stop words included', queryOfTokens, caps.maxQueryTerms, 'TOO_MANY_TERMS'],
  ] as const)('%s', (__, queryOf, cap, code) => {
    expect(hitIds(searchState(state, queryOf(cap)))).toEqual([2]);
    expect(() => searchState(state, queryOf(cap + 1))).toThrow(expect.objectContaining({ code }));
    expect(hitIds(searchState(state, queryOf(cap + 1), { truncateQuery: true }))).toEqual([1, 2]);
  });

  test('maxExpansions indexed terms per query term', () => {
    const records = (count: number) =>
      Array.from({ length: count }, (__, index) => ({
        id: index,
        text: `ka${LETTERS.charAt(Math.floor(index / LETTERS.length))}${LETTERS.charAt(index % LETTERS.length)}`,
      }));
    const withLimits = limits === undefined ? ENGINE_OPTIONS : { ...ENGINE_OPTIONS, limits };
    const totalOf = (count: number) =>
      searchRecords(records(count), withLimits, 'ka', { limit: DEFAULT_LIMITS.maxExpansions + 1 }).total;

    expect([totalOf(caps.maxExpansions), totalOf(caps.maxExpansions + 1)]).toEqual([
      caps.maxExpansions,
      caps.maxExpansions,
    ]);
  });
});

test('FR-16 the edit distance is capped at 2 for long terms', () => {
  const records = [
    { id: 1, text: 'elephxnty' },
    { id: 2, text: 'elxphxnty' },
  ];

  expect(hitIds(searchRecords(records, ENGINE_OPTIONS, 'elephants', { prefix: false }))).toEqual([1]);
});
