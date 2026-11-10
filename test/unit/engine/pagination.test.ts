import { describe, expect, test } from 'vitest';
import { buildState, hitIds, searchState } from '../../support/engine.ts';

const RECORDS = [
  { id: 1, text: 'apple pear' },
  { id: 2, text: 'apple apple fruit' },
  { id: 3, text: 'fruit' },
  { id: 4, text: 'apple' },
  { id: 5, text: 'pear fruit' },
  { id: 6, text: 'apple fruit apple apple' },
  { id: 7, text: 'fruit fruit' },
  { id: 8, text: 'apple pear apple' },
];

const PAGE_SIZE = 2;

const WHOLE_RESULT = 1000;

describe.each([
  ['a ranked query', 'apple'],
  ['a negation-only query', '-pear'],
  ['an empty query', ''],
])('FR-9 pagination of %s', (_, query) => {
  const state = buildState(RECORDS, { keys: ['text'] });
  const whole = searchState(state, query, { limit: WHOLE_RESULT });

  test('pages of one size concatenate to the unpaginated result and each states its total', () => {
    const pages = Array.from({ length: Math.ceil(whole.total / PAGE_SIZE) }, (_, pageIndex) =>
      searchState(state, query, { offset: pageIndex * PAGE_SIZE, limit: PAGE_SIZE }),
    );

    expect(pages.flatMap((page) => hitIds(page))).toEqual(hitIds(whole));
    expect(pages.map((page) => page.total)).toEqual(pages.map(() => whole.hits.length));
  });

  test.each([
    ['limit 0', { offset: 0, limit: 0 }],
    ['an offset past the total', { offset: RECORDS.length + 1, limit: PAGE_SIZE }],
  ])('%s returns an empty page with the unpaginated total', (_, page) => {
    const response = searchState(state, query, page);

    expect(response).toEqual({ total: whole.hits.length, hits: [] });
  });
});
