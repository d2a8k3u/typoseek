import { describe, expect, test } from 'vitest';
import { median, nearestRank, slicePhase } from '../../../bench/measure.ts';

describe('nearestRank', () => {
  test.each([
    ['p95 of 1 to 200', 0.95, Array.from({ length: 200 }, (_, index) => index + 1), 190],
    ['p95 of three samples', 0.95, [4, 9, 30], 30],
    ['p50 of four samples', 0.5, [1, 2, 3, 4], 2],
  ])('takes the nearest-rank %s', (_, fraction, samples, expected) => {
    expect(nearestRank(samples, fraction)).toBe(expected);
  });
});

describe('median', () => {
  test.each([
    [[30, 10, 20], 20],
    [[40, 10, 30, 20], 25],
  ])('takes the median of %j as %d', (values, expected) => {
    expect(median(values)).toBe(expected);
  });
});

describe('slicePhase', () => {
  test.each([
    [0, 0, false, 'preparation'],
    [0, 512, false, 'commit'],
    [512, 1024, true, 'commit'],
    [1024, 1024, true, 'idle'],
    [1024, 600, true, 'rollback'],
  ] as const)('classifies a gap from size %d to %d, committed before: %s, as %s', (before, after, committed, phase) => {
    expect(slicePhase(before, after, committed)).toBe(phase);
  });
});
