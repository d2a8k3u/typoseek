import { describe, expect, test } from 'vitest';
import { compareCodePoints, compareTermRank, RadixTree, type RadixNode } from '../../../src/core/radix-tree.ts';

interface Shape {
  readonly [edge: string]: readonly [value: number | undefined, minTermLength: number, children: Shape];
}

function shapeOf(nodes: readonly RadixNode<number>[]): Shape {
  return Object.fromEntries(
    nodes.map((node) => [node.edge, [node.value, node.minTermLength, shapeOf(node.children)] as const]),
  );
}

function treeOf(terms: readonly string[]): RadixTree<number> {
  const tree = new RadixTree<number>();
  for (const [position, term] of terms.entries()) {
    tree.set(term, position);
  }
  return tree;
}

function edgeOrder(tree: RadixTree<number>): readonly string[] {
  return tree.root.children.map((child) => child.edge);
}

describe('RadixTree set and get', () => {
  test('returns the value stored for a term and nothing for a prefix, an extension or another term', () => {
    const tree = treeOf(['search', 'seek', 'sea']);

    expect(['search', 'seek', 'sea'].map((term) => tree.get(term))).toEqual([0, 1, 2]);
    expect(['se', 'searches', 'seal', 'x', ''].map((term) => tree.get(term))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  test('replaces the value of a term that is set again', () => {
    const tree = treeOf(['seek', 'seek']);

    expect(tree.get('seek')).toBe(1);
    expect(shapeOf(tree.root.children)).toEqual({ seek: [1, 4, {}] });
  });

  test('splits an edge at the first differing code point and keeps one node per shared prefix', () => {
    const tree = treeOf(['search', 'seek', 'sea']);

    expect(shapeOf([tree.root])).toEqual({
      '': [
        undefined,
        3,
        {
          se: [
            undefined,
            3,
            {
              a: [2, 3, { rch: [0, 6, {}] }],
              ek: [1, 4, {}],
            },
          ],
        },
      ],
    });
  });

  test.each([
    [['a𝐀', 'a𝐁'], { a: [undefined, 2, { '𝐀': [0, 2, {}], '𝐁': [1, 2, {}] }] }],
    [['a𝐀', 'a\ud835'], { a: [undefined, 2, { '\ud835': [1, 2, {}], '𝐀': [0, 2, {}] }] }],
    [['a\ud835', 'a𝐀'], { a: [undefined, 2, { '\ud835': [0, 2, {}], '𝐀': [1, 2, {}] }] }],
    [['a\ud835b', 'a\ud835c'], { 'a\ud835': [undefined, 3, { b: [0, 3, {}], c: [1, 3, {}] }] }],
  ])('splits %j only between code points', (terms, shape) => {
    expect(shapeOf(treeOf(terms).root.children)).toEqual(shape);
  });

  test.each([[['b', '𝐀', '￿', 'a']], [['￿', 'a', '𝐀', 'b']]])(
    'keeps sibling edges in code point order when inserted as %j',
    (terms) => {
      expect(edgeOrder(treeOf(terms))).toEqual(['a', 'b', '￿', '𝐀']);
    },
  );

  test('counts the shortest term below a node in code points and lowers it along the inserted path', () => {
    const tree = treeOf(['𝐀𝐀𝐀𝐀', '𝐀𝐀']);

    expect(shapeOf([tree.root])).toEqual({
      '': [undefined, 2, { '𝐀𝐀': [1, 2, { '𝐀𝐀': [0, 4, {}] }] }],
    });
  });

  test('reports an infinite shortest term for an empty tree', () => {
    expect(new RadixTree<number>().root).toEqual({
      edge: '',
      children: [],
      value: undefined,
      minTermLength: Number.POSITIVE_INFINITY,
    });
  });
});

describe('RadixTree delete', () => {
  test.each([['se'], ['searches'], ['x'], ['']])('reports %j as not stored and leaves the tree as it was', (term) => {
    const tree = treeOf(['search', 'seek']);
    const before = shapeOf([tree.root]);

    expect(tree.delete(term)).toBe(false);
    expect(shapeOf([tree.root])).toEqual(before);
  });

  test('removes a leaf and merges its parent with the one child that is left', () => {
    const tree = treeOf(['search', 'seek', 'x']);

    expect(tree.delete('seek')).toBe(true);
    expect(tree.get('seek')).toBeUndefined();
    expect(shapeOf([tree.root])).toEqual({
      '': [undefined, 1, { search: [0, 6, {}], x: [2, 1, {}] }],
    });
  });

  test('merges a node that loses its value with its only child', () => {
    const tree = treeOf(['sea', 'search']);

    expect(tree.delete('sea')).toBe(true);
    expect(shapeOf([tree.root])).toEqual({ '': [undefined, 6, { search: [1, 6, {}] }] });
  });

  test('keeps a node that loses its value while it still joins several children', () => {
    const tree = treeOf(['se', 'search', 'seek']);

    expect(tree.delete('se')).toBe(true);
    expect(shapeOf([tree.root])).toEqual({
      '': [undefined, 4, { se: [undefined, 4, { arch: [1, 6, {}], ek: [2, 4, {}] }] }],
    });
  });

  test('keeps a node with a value when its only child is removed', () => {
    const tree = treeOf(['sea', 'search']);

    expect(tree.delete('search')).toBe(true);
    expect(shapeOf([tree.root])).toEqual({ '': [undefined, 3, { sea: [0, 3, {}] }] });
  });

  test('raises the shortest term along the whole deleted path', () => {
    const tree = treeOf(['a', 'ab', 'abcd', 'abxyz', 'q']);

    expect(tree.delete('ab')).toBe(true);
    expect(tree.delete('a')).toBe(true);
    expect(shapeOf([tree.root])).toEqual({
      '': [undefined, 1, { ab: [undefined, 4, { cd: [2, 4, {}], xyz: [3, 5, {}] }], q: [4, 1, {}] }],
    });
  });

  test('returns to the empty tree after the last term is deleted', () => {
    const tree = treeOf(['search', 'seek', '']);

    expect(['seek', 'search', ''].map((term) => tree.delete(term))).toEqual([true, true, true]);
    expect(tree.root).toEqual(new RadixTree<number>().root);
  });
});

describe('compareCodePoints', () => {
  test.each([
    ['abc', 'abd', -1],
    ['abd', 'abc', 1],
    ['abc', 'abc', 0],
    ['ab', 'abc', -1],
    ['abc', 'ab', 1],
    ['￿', '𝐀', -1],
    ['𝐀', '￿', 1],
    ['𝐀', '𝐁', -1],
    ['a𝐀', 'a\ud835', 1],
    ['\ud835b', '\ud835c', -1],
  ])('orders %j against %j by code point as %i', (a, b, sign) => {
    expect(Math.sign(compareCodePoints(a, b))).toBe(sign);
  });
});

describe('compareTermRank', () => {
  test.each([
    ['b', 'aa', -1],
    ['aa', 'b', 1],
    ['𝐀𝐀', 'aaa', -1],
    ['ab', 'ac', -1],
    ['ab', 'ab', 0],
  ])('orders %j against %j by code point length, then code point as %i', (a, b, sign) => {
    expect(Math.sign(compareTermRank(a, b))).toBe(sign);
  });
});
