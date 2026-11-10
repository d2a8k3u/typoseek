import { describe, expect, test } from 'vitest';
import type { Filter, SortBy } from '../../../src/types.ts';
import { buildState, hitIds, searchState } from '../../support/engine.ts';

interface Product {
  readonly id: number;
  readonly name: string;
  readonly price: number;
  readonly added: Date;
}

const PRODUCTS: readonly Product[] = [
  { id: 1, name: 'red shirt', price: 30, added: new Date('2026-01-10T00:00:00Z') },
  { id: 2, name: 'blue shirt', price: 10, added: new Date('2026-03-05T00:00:00Z') },
  { id: 3, name: 'red scarf', price: 20, added: new Date('2026-02-20T00:00:00Z') },
  { id: 4, name: 'red shirt red', price: 10, added: new Date('2026-04-01T00:00:00Z') },
  { id: 5, name: 'green hat', price: 20, added: new Date('2026-05-15T00:00:00Z') },
];

const WHOLE_RESULT = 1000;

const state = buildState(PRODUCTS, { keys: ['name'] });

describe('FR-8 a filter combined with a text query returns the intersection', () => {
  test.each<readonly [string, Filter<Product>, readonly number[]]>([
    ['a predicate', (product) => product.price > 15, [1, 3]],
    ['an equality condition', { key: 'price', equals: 10 }, [4]],
    ['a numeric range', { key: 'price', range: { lt: 25 } }, [3, 4]],
    ['a date range', { key: 'added', range: { lt: new Date('2026-03-01T00:00:00Z') } }, [1, 3]],
  ])('%s', (_, filter, ids) => {
    const response = searchState(state, 'red', { filter, limit: WHOLE_RESULT });

    expect(new Set(hitIds(response))).toEqual(new Set(ids));
  });
});

describe('FR-8 sorting by a field replaces relevance and keeps ties in original order', () => {
  test.each<readonly [string, string, SortBy<Product>, readonly number[]]>([
    ['ascending', '', { key: 'price', direction: 'asc' }, [2, 4, 3, 5, 1]],
    ['descending', '', { key: 'price', direction: 'desc' }, [1, 3, 5, 2, 4]],
    ['descending after a text query that ranks record 4 first', 'red', { key: 'price', direction: 'desc' }, [1, 3, 4]],
  ])('%s', (_, query, sortBy, ids) => {
    const response = searchState(state, query, { sortBy, limit: WHOLE_RESULT });

    expect(hitIds(response)).toEqual(ids);
  });
});
