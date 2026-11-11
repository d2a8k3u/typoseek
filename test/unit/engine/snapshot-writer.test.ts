import { describe, expect, test } from 'vitest';
import { createIndex } from '../../../src/engine/create-index.ts';
import { FIELD_BREAK, VALUE_BREAK } from '../../../src/engine/state.ts';
import type { SearchIndex } from '../../../src/types.ts';

interface Book {
  readonly id: string;
  readonly title: string;
  readonly tags: readonly string[];
}

const ASTRAL_STOP_WORD = '\u{1F600}';
const PRIVATE_USE_STOP_WORD = '';

function bookIndex(): SearchIndex<Book> {
  return createIndex<Book>({
    idKey: 'id',
    keys: [{ path: 'title', weight: 2 }, 'tags'],
    stopWords: ['the', 'And', ASTRAL_STOP_WORD, PRIVATE_USE_STOP_WORD],
    limits: { maxExpansions: 7 },
  });
}

describe('toJSON', () => {
  test('writes options, sorted stop terms, surfaces renumbered densely in first use, and records in docNum order', () => {
    const index = bookIndex();
    index.addAll([
      { id: 'x', title: 'The Fox', tags: ['red'] },
      { id: 'y', title: 'owl', tags: [] },
    ]);
    index.remove('x');
    const added: Book = { id: 'z', title: 'Red fox and owl', tags: ['den', 'fox'] };
    index.add(added);
    const updated: Book = { id: 'y', title: 'big owl', tags: ['night'] };
    index.update(updated);

    const snapshot = index.toJSON();

    expect(snapshot).toEqual({
      format: 'typoseek-index',
      version: 1,
      idKey: 'id',
      keys: [
        { path: 'title', weight: 2 },
        { path: 'tags', weight: 1 },
      ],
      limits: { maxQueryLength: 256, maxQueryTerms: 16, maxExpansions: 7 },
      stopTerms: ['and', 'the', PRIVATE_USE_STOP_WORD, ASTRAL_STOP_WORD],
      surfaces: [
        ['big', 'big'],
        ['owl', 'owl'],
        ['night', 'night'],
        ['Red', 'red'],
        ['fox', 'fox'],
        ['and', null],
        ['den', 'den'],
      ],
      records: [
        [updated, [2, 1, 0, 1, FIELD_BREAK, 2]],
        [added, [3, 2, 3, 4, 5, 1, FIELD_BREAK, 6, VALUE_BREAK, 4]],
      ],
    });
    expect(snapshot.records.map(([item]) => item)).toEqual([updated, added]);
    expect(snapshot.records[0]?.[0]).toBe(updated);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  test('rejects toJSON with INDEX_BUSY while addAllAsync runs, and writes the records once the run settles', async () => {
    const index = bookIndex();

    const run = index.addAllAsync([{ id: 'x', title: 'fox', tags: [] }]);

    expect(() => index.toJSON()).toThrow(expect.objectContaining({ name: 'TyposeekError', code: 'INDEX_BUSY' }));
    await run;
    expect(index.toJSON().records).toHaveLength(1);
  });
});
