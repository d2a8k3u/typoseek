import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { createIndex } from '../../../src/engine/create-index.ts';
import { search } from '../../../src/engine/one-shot.ts';
import type { FieldMatch } from '../../../src/types.ts';

const RUNS = 1000;
const STOP_WORDS = ['the'];

interface Card {
  readonly title: string;
  readonly tags?: readonly string[];
}

interface ComparableHit {
  readonly position: number;
  readonly item: unknown;
  readonly matches: readonly FieldMatch[];
}

const word = fc.constantFrom('red', 'reed', 'fox', 'foxes', 'owl', 'bowl', 'night', 'knight', 'the', 'Øre', '', '!!');
const text = fc.array(word, { maxLength: 4 }).map((words) => words.join(' '));
const queryTerm = fc.oneof(
  word,
  word.map((value) => value.slice(0, 2)),
  fc.constantFrom('fxo', 'nigth', 'ore'),
);
const query = fc.oneof(
  fc.array(queryTerm, { maxLength: 3 }).map((terms) => terms.join(' ')),
  fc.constantFrom('"red fox"', 'owl -bowl', 'the'),
);
const searchOptions = fc.record(
  {
    fold: fc.boolean(),
    mode: fc.constantFrom('and' as const, 'or' as const),
    prefix: fc.boolean(),
    infix: fc.boolean(),
    offset: fc.nat({ max: 2 }),
    limit: fc.nat({ max: 5 }),
  },
  { requiredKeys: [] },
);
const card: fc.Arbitrary<Card> = fc.record(
  { title: text, tags: fc.array(text, { maxLength: 2 }) },
  { requiredKeys: ['title'] },
);

describe('FR-11 one-shot search equals an index built by adding the same items in order', () => {
  test('for string items, compared with an index of { id, text } records under key text', () => {
    fc.assert(
      fc.property(fc.array(text, { maxLength: 6 }), query, searchOptions, (texts, searched, options) => {
        const index = createIndex<{ readonly id: number; readonly text: string }>({
          idKey: 'id',
          keys: ['text'],
          stopWords: STOP_WORDS,
        });
        index.addAll(texts.map((value, position) => ({ id: position, text: value })));
        const fromIndex = index.search(searched, options);

        const oneShot = search(texts, searched, { ...options, stopWords: STOP_WORDS });

        expect(oneShot.total).toBe(fromIndex.total);
        expect(
          oneShot.hits.map(({ refIndex, item, matches }): ComparableHit => ({ position: refIndex, item, matches })),
        ).toEqual(
          fromIndex.hits.map(({ id, item, matches }): ComparableHit => ({
            position: Number(id),
            item: item.text,
            matches: matches.map((match) => ({ ...match, key: '' })),
          })),
        );
      }),
      { numRuns: RUNS },
    );
  });

  test('for object items, compared with an index of the items with an added id property', () => {
    fc.assert(
      fc.property(fc.array(card, { maxLength: 6 }), query, searchOptions, (cards, searched, options) => {
        const index = createIndex<Card & { readonly id: number }>({
          idKey: 'id',
          keys: ['title', 'tags'],
          stopWords: STOP_WORDS,
        });
        index.addAll(cards.map((item, position) => ({ ...item, id: position })));
        const fromIndex = index.search(searched, options);

        const oneShot = search(cards, searched, { ...options, keys: ['title', 'tags'], stopWords: STOP_WORDS });

        expect(oneShot.total).toBe(fromIndex.total);
        expect(
          oneShot.hits.map(({ refIndex, item, matches }): ComparableHit => ({ position: refIndex, item, matches })),
        ).toEqual(
          fromIndex.hits.map(({ id, matches }): ComparableHit => ({
            position: Number(id),
            item: cards[Number(id)],
            matches,
          })),
        );
      }),
      { numRuns: RUNS },
    );
  });
});
