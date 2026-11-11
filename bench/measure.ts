import { itemAt } from './random.ts';

export type SlicePhase = 'preparation' | 'commit' | 'rollback' | 'idle';

export function nearestRank(ascending: readonly number[], fraction: number): number {
  return itemAt(ascending, Math.ceil(fraction * ascending.length) - 1);
}

export function median(values: readonly number[]): number {
  const ascending = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ascending.length / 2);
  return ascending.length % 2 === 1
    ? itemAt(ascending, middle)
    : (itemAt(ascending, middle - 1) + itemAt(ascending, middle)) / 2;
}

export function slicePhase(sizeBefore: number, sizeAfter: number, committedBefore: boolean): SlicePhase {
  if (sizeAfter > sizeBefore) {
    return 'commit';
  }
  if (sizeAfter < sizeBefore) {
    return 'rollback';
  }
  return committedBefore ? 'idle' : 'preparation';
}
