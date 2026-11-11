export type Random = () => number;

const MULBERRY32_INCREMENT = 0x6d2b79f5;

const UINT32_RANGE = 2 ** 32;

export function mulberry32(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + MULBERRY32_INCREMENT) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

export function integerBetween(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

export function itemAt<T>(items: ArrayLike<T>, index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new RangeError(`index ${String(index)} is outside a list of ${String(items.length)} items`);
  }
  return item;
}

export function pick<T>(random: Random, items: readonly T[]): T {
  return itemAt(items, Math.floor(random() * items.length));
}
