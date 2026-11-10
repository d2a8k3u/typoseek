import { describe, expect, test } from 'vitest';
import {
  compareRelevance,
  idf,
  termContribution,
  weightedFieldFrequency,
  type RankKey,
} from '../../../src/core/rank.ts';

const PRECISION_DIGITS = 12;

describe('idf', () => {
  test.each([
    [10, 1, 1.992430164690206],
    [10, 10, 0.04652001563489282],
    [1, 1, 0.2876820724517809],
  ])('of %i records with %i holding the term is %f', (recordCount, documentFrequency, expected) => {
    expect(idf(recordCount, documentFrequency)).toBeCloseTo(expected, PRECISION_DIGITS);
  });

  test('gives a rare term more weight than a common one', () => {
    expect(idf(100, 2)).toBeGreaterThan(idf(100, 60));
  });
});

describe('weightedFieldFrequency', () => {
  test.each([
    [1, 4, 1, 2, 2 / 3.25],
    [1, 4, 10, 1, 1 / 0.55],
    [3, 5, 5, 1, 3],
  ])(
    'of tf %i in a field of %i tokens averaging %i with weight %i is %f',
    (tf, fieldLength, averageFieldLength, weight, expected) => {
      expect(weightedFieldFrequency(tf, fieldLength, averageFieldLength, weight)).toBeCloseTo(
        expected,
        PRECISION_DIGITS,
      );
    },
  );

  test('gives a weight-2 key twice the value of a weight-1 key at the same length ratio', () => {
    expect(weightedFieldFrequency(2, 6, 3, 2)).toBeCloseTo(2 * weightedFieldFrequency(2, 20, 10, 1), PRECISION_DIGITS);
  });
});

describe('termContribution', () => {
  test.each([
    [1.2, 1.1],
    [1, 1],
    [1000, 2.197363164202956],
  ])('saturates %f to %f', (weightedFrequency, expected) => {
    expect(termContribution(weightedFrequency)).toBeCloseTo(expected, PRECISION_DIGITS);
  });

  test('keeps the order of the weighted frequencies', () => {
    const contributions = [0.5, 1, 2, 4].map(termContribution);

    expect(contributions).toEqual([...contributions].sort((a, b) => a - b));
  });
});

describe('compareRelevance', () => {
  const base: RankKey = { matchedClauses: 2, typoCost: 1, infixMatches: 1, prefixMatches: 1, score: 5, docNum: 4 };

  test.each<[string, Partial<RankKey>, Partial<RankKey>]>([
    ['more matched clauses before fewer typos', { matchedClauses: 3, typoCost: 2 }, { typoCost: 0 }],
    ['fewer typos before fewer infix matches', { typoCost: 0, infixMatches: 2 }, { infixMatches: 0 }],
    ['fewer infix matches before fewer prefix matches', { infixMatches: 0, prefixMatches: 2 }, { prefixMatches: 0 }],
    ['fewer prefix matches before a higher score', { prefixMatches: 0, score: 1 }, { score: 9 }],
    ['a higher score before the original order', { score: 6, docNum: 9 }, { docNum: 0 }],
    ['the earlier record on a full tie', { docNum: 3 }, {}],
  ])('ranks %s', (_tier, better, worse) => {
    const first = { ...base, ...better };
    const second = { ...base, ...worse };

    expect(compareRelevance(first, second)).toBeLessThan(0);
    expect(compareRelevance(second, first)).toBeGreaterThan(0);
  });
});
