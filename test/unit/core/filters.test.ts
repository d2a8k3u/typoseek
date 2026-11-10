import { describe, expect, test } from 'vitest';
import { compileFilter, compileSort } from '../../../src/core/filters.ts';
import type { Filter, RangeBounds, SortBy } from '../../../src/types.ts';

interface Item {
  readonly id: string;
  readonly values?: readonly (string | number | boolean | Date | null)[];
}

function keptIds(items: readonly Item[], filter: Filter<Item> | readonly Filter<Item>[]): readonly string[] {
  const predicate = compileFilter(filter);
  return items.filter((item) => predicate?.(item) === true).map((item) => item.id);
}

function invalidOption(option: string): unknown {
  const namesOption: unknown = expect.stringContaining(`${option} `);
  return expect.objectContaining({ name: 'TyposeekError', code: 'INVALID_OPTION', message: namesOption });
}

test('compiles nothing without a filter or a sortBy', () => {
  expect(compileFilter(undefined)).toBeUndefined();
  expect(compileSort(undefined)).toBeUndefined();
});

describe('compileFilter', () => {
  const tagged: readonly Item[] = [
    { id: 'text', values: ['red', 'blue'] },
    { id: 'number', values: [1] },
    { id: 'null', values: [null] },
    { id: 'missing' },
  ];

  test.each([
    ['any resolved value', 'blue', ['text']],
    ['a number without coercion from text', 1, ['number']],
    ['text without coercion to a number', '1', []],
    ['null', null, ['null']],
  ])('equals matches %s strictly', (_label, equals, ids) => {
    expect(keptIds(tagged, { key: 'values', equals })).toEqual(ids);
  });

  const ranged: readonly Item[] = [
    { id: 'four', values: [4] },
    { id: 'five', values: [5] },
    { id: 'six', values: ['six', 6] },
    { id: 'date', values: [new Date(5)] },
    { id: 'text', values: ['5', true] },
    { id: 'missing' },
  ];

  test.each<[string, RangeBounds, readonly string[]]>([
    ['gt excludes the bound', { gt: 5 }, ['six']],
    ['gte includes the bound', { gte: 5 }, ['five', 'six', 'date']],
    ['lt excludes the bound', { lt: 5 }, ['four']],
    ['lte includes the bound', { lte: 5 }, ['four', 'five', 'date']],
    ['two bounds', { gt: 4, lt: 6 }, ['five', 'date']],
    ['a Date bound as milliseconds', { gte: new Date(5), lte: new Date(5) }, ['five', 'date']],
  ])('range %s and matches numbers and Dates only', (_label, range, ids) => {
    expect(keptIds(ranged, { key: 'values', range })).toEqual(ids);
  });

  test.each<[string, Filter<Item> | readonly Filter<Item>[], readonly string[]]>([
    ['a predicate as given', (item) => item.id === 'four', ['four']],
    [
      'an array as the conjunction of its filters',
      [(item) => item.id !== 'five', { key: 'values', range: { gte: 5 } }],
      ['six', 'date'],
    ],
  ])('applies %s', (_label, filter, ids) => {
    expect(keptIds(ranged, filter)).toEqual(ids);
  });

  test.each<[string, unknown, string]>([
    ['a string', 'values', 'filter'],
    ['null', null, 'filter'],
    ['a spec without a key', { equals: 1 }, 'filter.key'],
    ['a key that is not a string', { key: 1, equals: 1 }, 'filter.key'],
    ['a key path the parser rejects', { key: 'a.b.c.d.e.f', equals: 1 }, 'filter.key'],
    ['a spec with neither equals nor range', { key: 'values' }, 'filter'],
    ['a spec with both equals and range', { key: 'values', equals: 1, range: { gt: 1 } }, 'filter'],
    ['an object to equal', { key: 'values', equals: {} }, 'filter.equals'],
    ['NaN to equal', { key: 'values', equals: Number.NaN }, 'filter.equals'],
    ['a range that is not an object', { key: 'values', range: 5 }, 'filter.range'],
    ['a range without a bound', { key: 'values', range: {} }, 'filter.range'],
    ['a range with gt and gte', { key: 'values', range: { gt: 1, gte: 1 } }, 'filter.range'],
    ['a range with lt and lte', { key: 'values', range: { lt: 1, lte: 1 } }, 'filter.range'],
    ['an infinite bound', { key: 'values', range: { lte: Infinity } }, 'filter.range.lte'],
    ['an invalid Date bound', { key: 'values', range: { gt: new Date(Number.NaN) } }, 'filter.range.gt'],
    ['a text bound', { key: 'values', range: { lt: '5' } }, 'filter.range.lt'],
    ['an invalid entry in an array', [() => true, 'values'], 'filter[1]'],
  ])('rejects %s as INVALID_OPTION naming the option', (_label, filter, option) => {
    expect(() => compileFilter(filter as Filter<Item>)).toThrow(invalidOption(option));
  });
});

describe('compileSort', () => {
  const unsorted: readonly Item[] = [
    { id: 'missing' },
    { id: 'true', values: [true] },
    { id: 'a', values: ['a'] },
    { id: 'three', values: [3] },
    { id: 'null', values: [null] },
    { id: 'B', values: ['B'] },
    { id: 'false', values: [false] },
    { id: 'two', values: [2, 0] },
    { id: 'a again', values: ['a'] },
    { id: 'date one', values: [new Date(1)] },
  ];

  function sortedIds(sortBy: SortBy<Item>): readonly string[] {
    const sort = compileSort(sortBy);
    if (sort === undefined) {
      throw new Error('expected a compiled sort');
    }
    return [...unsorted]
      .sort((left, right) => sort.compare(sort.keyOf(left), sort.keyOf(right)))
      .map((item) => item.id);
  }

  const ascending = ['date one', 'two', 'three', 'B', 'a', 'a again', 'false', 'true', 'missing', 'null'];

  test.each<[string, SortBy<Item>, readonly string[]]>([
    ['ascending by default', { key: 'values' }, ascending],
    ['ascending', { key: 'values', direction: 'asc' }, ascending],
    [
      'descending',
      { key: 'values', direction: 'desc' },
      ['true', 'false', 'a', 'a again', 'B', 'three', 'two', 'date one', 'missing', 'null'],
    ],
  ])(
    'orders by the first value %s: numbers and Dates, code-unit strings, booleans, then missing, ties equal',
    (_label, sortBy, ids) => {
      expect(sortedIds(sortBy)).toEqual(ids);
    },
  );

  test.each<[string, unknown, string]>([
    ['null', null, 'sortBy'],
    ['a string', 'values', 'sortBy'],
    ['a key path the parser rejects', { key: 'a.__proto__' }, 'sortBy.key'],
    ['an unknown direction', { key: 'values', direction: 'up' }, 'sortBy.direction'],
  ])('rejects %s as INVALID_OPTION naming the option', (_label, sortBy, option) => {
    expect(() => compileSort(sortBy as SortBy<Item>)).toThrow(invalidOption(option));
  });
});
