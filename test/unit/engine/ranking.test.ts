import { describe, expect, test } from 'vitest';
import type { SearchOptions } from '../../../src/types.ts';
import { buildState, hitIds, searchRecords, searchState } from '../../support/engine.ts';

interface Doc {
  readonly id: number;
  readonly text: string;
}

const TEXT_KEY = { keys: ['text'] } as const;

const REPEATED_RUNS = 100;

function docs(...texts: readonly string[]): readonly Doc[] {
  return texts.map((text, index) => ({ id: index + 1, text }));
}

test('FR-3 a match in a weight-2 key ranks above the same match in a weight-1 key of the same length ratio', () => {
  const records = [
    { id: 1, title: 'omega', body: 'alpha' },
    { id: 2, title: 'alpha', body: 'omega' },
  ];

  const response = searchRecords(records, { keys: [{ path: 'title', weight: 2 }, 'body'] }, 'alpha');

  expect(hitIds(response)).toEqual([2, 1]);
});

describe('FR-4 ranking', () => {
  test('(a) an exact match ranks above a 1-edit match, which ranks above a 2-edit match', () => {
    const response = searchRecords(docs('elephxnty', 'elephamts', 'elephants'), TEXT_KEY, 'elephants');

    expect(hitIds(response)).toEqual([3, 2, 1]);
  });

  test('(b) a record matching a rare term outranks records matching a common term', () => {
    const response = searchRecords(docs('common', 'common', 'common', 'rare'), TEXT_KEY, 'common rare', {
      mode: 'or',
    });

    expect(hitIds(response)).toEqual([4, 1, 2, 3]);
  });

  test('(c) identical inputs yield the identical order on every run, ties in original order', () => {
    const records = [
      { id: 5, text: 'same tie' },
      { id: 3, text: 'same tie' },
      { id: 9, text: 'same tie' },
      { id: 1, text: 'tie' },
    ];

    const orders = Array.from({ length: REPEATED_RUNS }, () => hitIds(searchRecords(records, TEXT_KEY, 'tie')));

    expect(new Set(orders.map((order) => order.join(',')))).toEqual(new Set(['1,5,3,9']));
  });

  test('(d) for one query term without typos an exact match ranks above a prefix match, which ranks above an infix match', () => {
    const response = searchRecords(docs('bobcat', 'catalog', 'cat'), TEXT_KEY, 'cat');

    expect(hitIds(response)).toEqual([3, 2, 1]);
  });

  test('a record ranks by its best match for a query term, not by a weaker match it also holds', () => {
    const response = searchRecords(docs('catalog', 'catalog cat'), TEXT_KEY, 'cat');

    expect(hitIds(response)).toEqual([2, 1]);
  });

  describe('(e) infix matching only for the last token of the query when it is a positive term clause of 3 or more code points', () => {
    const state = buildState(docs('bobcat', 'bobcat big dog', 'tomcat lynx'), TEXT_KEY);

    test.each<readonly [string, string, SearchOptions<Doc>, readonly number[]]>([
      ['a last term of 3 code points', 'cat', {}, [1, 2, 3]],
      ['a last term after other terms', 'big cat', {}, [2]],
      ['a last term of 2 code points', 'at', {}, []],
      ['a last term of 1 code point', 'c', {}, []],
      ['a term that is not the last', 'cat big', {}, []],
      ['a query that ends in a negated term', 'cat -lynx', {}, []],
      ['a query that ends in a phrase', 'cat "big dog"', {}, []],
      ['infix disabled', 'cat', { infix: false }, []],
    ])('%s: %s', (_, query, options, ids) => {
      expect(new Set(hitIds(searchState(state, query, options)))).toEqual(new Set(ids));
    });
  });
});

test('with fold: false the term frequency counts only tokens equal to the query token', () => {
  const records = [
    { id: 1, title: 'Café', body: 'cafe cafe cafe' },
    { id: 2, title: 'Café', body: 'Café' },
  ];

  const response = searchRecords(records, { keys: ['title', 'body'] }, 'Café', { fold: false });

  expect(hitIds(response)).toEqual([2, 1]);
});

test('with mode or a record matching more clauses ranks above a record whose fewer matches score higher', () => {
  const longRecordFillerWords = 18;
  const records = docs('zebra', `zebra lion${' filler'.repeat(longRecordFillerWords)}`, 'lion');

  const response = searchRecords(records, TEXT_KEY, 'zebra lion', { mode: 'or' });

  expect(hitIds(response)).toEqual([2, 1, 3]);
});

test('a positive term repeated in the query counts as one clause', () => {
  const response = searchRecords(docs('dog', 'cat'), TEXT_KEY, 'cat cat dog', { mode: 'or' });

  expect(hitIds(response)).toEqual([1, 2]);
});
