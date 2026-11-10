export class BinaryHeap<T> {
  private readonly items: T[] = [];
  private readonly compare: (a: T, b: T) => number;

  constructor(compare: (a: T, b: T) => number) {
    this.compare = compare;
  }

  get size(): number {
    return this.items.length;
  }

  peek(): T | undefined {
    return this.items[0];
  }

  push(item: T): void {
    let index = this.items.length;
    this.items.push(item);
    for (;;) {
      const parentIndex = (index - 1) >> 1;
      const parent = this.items[parentIndex];
      if (parent === undefined || this.compare(parent, item) <= 0) {
        break;
      }
      this.items[index] = parent;
      index = parentIndex;
    }
    this.items[index] = item;
  }

  pop(): T | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (last === undefined || this.items.length === 0) {
      return top;
    }
    let index = 0;
    for (;;) {
      const rightIndex = 2 * index + 2;
      const left = this.items[rightIndex - 1];
      const right = this.items[rightIndex];
      if (left === undefined) {
        break;
      }
      const rightIsFirst = right !== undefined && this.compare(right, left) < 0;
      const child = rightIsFirst ? right : left;
      if (this.compare(last, child) <= 0) {
        break;
      }
      this.items[index] = child;
      index = rightIsFirst ? rightIndex : rightIndex - 1;
    }
    this.items[index] = last;
    return top;
  }
}
