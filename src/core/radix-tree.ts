export interface RadixNode<V> {
  readonly edge: string;
  readonly children: readonly RadixNode<V>[];
  readonly value: V | undefined;
  readonly minTermLength: number;
}

const HIGH_SURROGATE_START = 0xd800;
const LOW_SURROGATE_START = 0xdc00;
const SURROGATE_END = 0xdfff;
const SURROGATE_PAYLOAD_SIZE = 0x400;
const FIRST_ASTRAL_CODE_POINT = 0x10000;

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= HIGH_SURROGATE_START && codeUnit < LOW_SURROGATE_START;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= LOW_SURROGATE_START && codeUnit <= SURROGATE_END;
}

export function isCodePointBoundary(text: string, index: number): boolean {
  return !(isHighSurrogate(text.charCodeAt(index - 1)) && isLowSurrogate(text.charCodeAt(index)));
}

function codePointFrom(text: string, index: number): number {
  const codeUnit = text.charCodeAt(index);
  const nextCodeUnit = text.charCodeAt(index + 1);
  return isHighSurrogate(codeUnit) && isLowSurrogate(nextCodeUnit)
    ? FIRST_ASTRAL_CODE_POINT +
        (codeUnit - HIGH_SURROGATE_START) * SURROGATE_PAYLOAD_SIZE +
        (nextCodeUnit - LOW_SURROGATE_START)
    : codeUnit;
}

function codeUnitLength(codePoint: number): number {
  return codePoint < FIRST_ASTRAL_CODE_POINT ? 1 : 2;
}

export function codePointLength(text: string): number {
  let length = 0;
  for (let index = 0; index < text.length; index += codeUnitLength(codePointFrom(text, index))) {
    length += 1;
  }
  return length;
}

export function compareCodePoints(a: string, b: string): number {
  let index = 0;
  while (index < a.length && index < b.length) {
    const left = codePointFrom(a, index);
    const right = codePointFrom(b, index);
    if (left !== right) {
      return left - right;
    }
    index += codeUnitLength(left);
  }
  return a.length - b.length;
}

export function compareTermRank(a: string, b: string): number {
  return codePointLength(a) - codePointLength(b) || compareCodePoints(a, b);
}

interface MutableNode<V> {
  edge: string;
  children: MutableNode<V>[];
  value: V | undefined;
  minTermLength: number;
}

function countChildrenBefore<V>(children: readonly MutableNode<V>[], firstCodePoint: number): number {
  let step = 1;
  while (step * 2 <= children.length) {
    step *= 2;
  }
  let before = 0;
  for (; step > 0; step >>= 1) {
    const candidate = children[before + step - 1];
    if (candidate !== undefined && codePointFrom(candidate.edge, 0) < firstCodePoint) {
      before += step;
    }
  }
  return before;
}

function sharedPrefixLength(edge: string, text: string): number {
  let shared = 0;
  while (shared < edge.length && edge.charCodeAt(shared) === text.charCodeAt(shared)) {
    shared += 1;
  }
  return isCodePointBoundary(edge, shared) && isCodePointBoundary(text, shared) ? shared : shared - 1;
}

function splitEdge<V>(parent: MutableNode<V>, position: number, child: MutableNode<V>, shared: number): MutableNode<V> {
  const upper: MutableNode<V> = {
    edge: child.edge.slice(0, shared),
    children: [child],
    value: undefined,
    minTermLength: child.minTermLength,
  };
  child.edge = child.edge.slice(shared);
  parent.children.splice(position, 1, upper);
  return upper;
}

interface PathStep<V> {
  readonly parent: MutableNode<V>;
  readonly parentDepth: number;
  readonly position: number;
  readonly child: MutableNode<V>;
}

function shortestTermLength<V>(node: MutableNode<V>, depth: number): number {
  return node.children.reduce(
    (shortest, child) => Math.min(shortest, child.minTermLength),
    node.value === undefined ? Number.POSITIVE_INFINITY : depth,
  );
}

function compressChild<V>(parent: MutableNode<V>, position: number, child: MutableNode<V>): void {
  if (child.value !== undefined || child.children.length > 1) {
    return;
  }
  const merged = child.children.map((only) => ({ ...only, edge: child.edge + only.edge }));
  parent.children.splice(position, 1, ...merged);
}

export class RadixTree<V> {
  private readonly rootNode: MutableNode<V> = {
    edge: '',
    children: [],
    value: undefined,
    minTermLength: Number.POSITIVE_INFINITY,
  };

  get root(): RadixNode<V> {
    return this.rootNode;
  }

  get(term: string): V | undefined {
    let node = this.rootNode;
    let rest = term;
    while (rest !== '') {
      const child = node.children[countChildrenBefore(node.children, codePointFrom(rest, 0))];
      if (child === undefined || !rest.startsWith(child.edge)) {
        return undefined;
      }
      node = child;
      rest = rest.slice(child.edge.length);
    }
    return node.value;
  }

  set(term: string, value: V): void {
    const termLength = codePointLength(term);
    let node = this.rootNode;
    let rest = term;
    node.minTermLength = Math.min(node.minTermLength, termLength);
    while (rest !== '') {
      const firstCodePoint = codePointFrom(rest, 0);
      const position = countChildrenBefore(node.children, firstCodePoint);
      const child = node.children[position];
      if (child === undefined || codePointFrom(child.edge, 0) !== firstCodePoint) {
        node.children.splice(position, 0, { edge: rest, children: [], value, minTermLength: termLength });
        return;
      }
      const shared = sharedPrefixLength(child.edge, rest);
      node = shared < child.edge.length ? splitEdge(node, position, child, shared) : child;
      node.minTermLength = Math.min(node.minTermLength, termLength);
      rest = rest.slice(shared);
    }
    node.value = value;
  }

  delete(term: string): boolean {
    const path: PathStep<V>[] = [];
    let node = this.rootNode;
    let depth = 0;
    let rest = term;
    while (rest !== '') {
      const position = countChildrenBefore(node.children, codePointFrom(rest, 0));
      const child = node.children[position];
      if (child === undefined || !rest.startsWith(child.edge)) {
        return false;
      }
      path.push({ parent: node, parentDepth: depth, position, child });
      depth += codePointLength(child.edge);
      node = child;
      rest = rest.slice(child.edge.length);
    }
    if (node.value === undefined) {
      return false;
    }
    node.value = undefined;
    node.minTermLength = shortestTermLength(node, depth);
    for (const { parent, parentDepth, position, child } of path.reverse()) {
      compressChild(parent, position, child);
      parent.minTermLength = shortestTermLength(parent, parentDepth);
    }
    return true;
  }
}
