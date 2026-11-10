import { expect, test } from 'vitest';
import { BinaryHeap } from '../../../src/core/heap.ts';

function ascending(a: number, b: number): number {
  return a - b;
}

function drain(heap: BinaryHeap<number>): readonly number[] {
  const popped: number[] = [];
  for (let item = heap.pop(); item !== undefined; item = heap.pop()) {
    popped.push(item);
  }
  return popped;
}

test.each([[[5, 3, 8, 1, 9, 2, 7, 3, 6, 4]], [[1, 2, 3, 4, 5, 6, 7]], [[7, 6, 5, 4, 3, 2, 1]], [[4]], [[]]])(
  'pops %j in the order of its comparator',
  (items) => {
    const heap = new BinaryHeap(ascending);
    for (const item of items) {
      heap.push(item);
    }

    expect(heap.size).toBe(items.length);
    expect(drain(heap)).toEqual([...items].sort(ascending));
    expect(heap.size).toBe(0);
  },
);

test('keeps its order when pushes and pops alternate', () => {
  const heap = new BinaryHeap(ascending);
  for (const item of [6, 2, 9]) {
    heap.push(item);
  }

  expect(heap.peek()).toBe(2);
  expect(heap.pop()).toBe(2);
  heap.push(1);
  heap.push(7);

  expect(heap.peek()).toBe(1);
  expect(drain(heap)).toEqual([1, 6, 7, 9]);
  expect(heap.peek()).toBeUndefined();
});
