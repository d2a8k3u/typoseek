import { BinaryHeap } from './heap';

export function selectPage<E>(
  entries: Iterable<E>,
  compare: (a: E, b: E) => number,
  offset: number,
  limit: number,
): { readonly total: number; readonly page: readonly E[] } {
  const windowSize = offset + limit;
  const window = new BinaryHeap<E>((a, b) => compare(b, a));
  let total = 0;
  for (const entry of entries) {
    total += 1;
    const worstKept = window.peek();
    if (window.size < windowSize) {
      window.push(entry);
    } else if (worstKept !== undefined && compare(entry, worstKept) < 0) {
      window.pop();
      window.push(entry);
    }
  }
  const worstFirst: E[] = [];
  for (let entry = window.pop(); entry !== undefined; entry = window.pop()) {
    worstFirst.push(entry);
  }
  return { total, page: worstFirst.reverse().slice(offset) };
}
