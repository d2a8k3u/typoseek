import { expect, test } from 'vitest';
import { selectPage } from '../../../src/core/top-k.ts';

const ENTRIES = [50, 20, 90, 10, 70, 30, 80, 60, 40];

function ascending(a: number, b: number): number {
  return a - b;
}

test.each([
  [0, 3, [10, 20, 30]],
  [2, 3, [30, 40, 50]],
  [7, 5, [80, 90]],
  [9, 2, []],
  [0, 9, [10, 20, 30, 40, 50, 60, 70, 80, 90]],
  [0, 0, []],
  [4, 0, []],
])('returns positions %i to %i more of the sorted entries and counts all of them', (offset, limit, page) => {
  expect(selectPage(ENTRIES, ascending, offset, limit)).toEqual({ total: ENTRIES.length, page });
});

test('reads a one-pass iterable', () => {
  const entries = new Set(ENTRIES).values();

  expect(selectPage(entries, ascending, 1, 2)).toEqual({ total: ENTRIES.length, page: [20, 30] });
});

test('compares each entry against a window of offset plus limit entries, not against all of them', () => {
  const ENTRY_COUNT = 1_000;
  const COMPARISONS_PER_ENTRY = 2;
  const scattered = Array.from({ length: ENTRY_COUNT }, (_, position) => (position * 7_919) % 1_009);
  let comparisons = 0;

  const { total, page } = selectPage(
    scattered,
    (a, b) => {
      comparisons += 1;
      return a - b;
    },
    2,
    2,
  );

  expect(total).toBe(ENTRY_COUNT);
  expect(page).toEqual([...scattered].sort(ascending).slice(2, 4));
  expect(comparisons).toBeLessThanOrEqual(COMPARISONS_PER_ENTRY * ENTRY_COUNT);
});
