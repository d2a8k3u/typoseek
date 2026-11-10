import { describe, expect, test } from 'vitest';
import { buildState, hitIds, searchState } from '../../support/engine.ts';

interface Note {
  readonly id: number | string;
  readonly text?: string;
}

const WHOLE_RESULT = 1000;

const MANY_NOTES = 30;

const FIXTURES: readonly (readonly [name: string, records: readonly Note[]])[] = [
  ['one record', [{ id: 1, text: 'lonely note' }]],
  [
    'string ids out of alphabetical order',
    [
      { id: 'c', text: 'third letter' },
      { id: 'a', text: 'first letter' },
      { id: 'b', text: 'second letter' },
    ],
  ],
  [
    'identical texts',
    [
      { id: 3, text: 'same words' },
      { id: 1, text: 'same words' },
      { id: 2, text: 'same words' },
    ],
  ],
  [
    'records without tokens or without the key',
    [{ id: 9, text: '' }, { id: 8, text: '!!!' }, { id: 7 }, { id: 6, text: 'words' }],
  ],
  [
    'many records with descending ids',
    Array.from({ length: MANY_NOTES }, (_, index) => ({ id: MANY_NOTES - index, text: `note ${String(index)}` })),
  ],
];

test.each(FIXTURES)('an empty query lists %s in original order', (_, records) => {
  const response = searchState(buildState(records, { keys: ['text'] }), '', { limit: WHOLE_RESULT });

  expect(hitIds(response)).toEqual(records.map((record) => record.id));
  expect(response.total).toBe(records.length);
});

test('an empty query with a filter keeps only the matching records in original order', () => {
  const records = Array.from({ length: MANY_NOTES }, (_, index) => ({ id: MANY_NOTES - index, text: 'note' }));
  const isEven = (note: Note): boolean => Number(note.id) % 2 === 0;

  const response = searchState(buildState(records, { keys: ['text'] }), '', {
    filter: isEven,
    limit: WHOLE_RESULT,
  });

  expect(hitIds(response)).toEqual(records.filter(isEven).map((record) => record.id));
});

describe('a query whose clauses all drop', () => {
  const records: readonly Note[] = [
    { id: 2, text: 'the second note' },
    { id: 1, text: 'a first note' },
    { id: 3, text: 'third' },
  ];
  const state = buildState(records, { keys: ['text'], stopWords: ['the', 'a'] });

  test.each([
    ['whitespace only', ' \t\n '],
    ['no tokens', '!!! ?'],
    ['stop words only', 'the a'],
    ['negated stop words only', '-the -"a"'],
  ])('%s lists every record in original order without matches', (_, query) => {
    const response = searchState(state, query, { limit: WHOLE_RESULT });

    expect(response.hits.map((hit) => [hit.id, hit.matches])).toEqual([
      [2, []],
      [1, []],
      [3, []],
    ]);
  });
});
