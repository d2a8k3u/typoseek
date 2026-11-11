import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { createIndex } from '../../../src/index.ts';
import { loadIndex } from '../../../src/serialize.ts';
import type { SerializedIndex } from '../../../src/types.ts';

const RUNS = 1000;

interface Card {
  readonly id: number;
  readonly title?: string;
  readonly tags?: readonly string[];
}

type Transport = (snapshot: SerializedIndex<Card>) => unknown;

const TRANSPORTS: readonly (readonly [name: string, transport: Transport])[] = [
  ['JSON', (snapshot) => JSON.parse(JSON.stringify(snapshot)) as unknown],
  ['structuredClone', (snapshot) => structuredClone(snapshot)],
];

const word = fc.constantFrom('red', 'reed', 'fox', 'foxes', 'owl', 'bowl', 'night', 'The', 'and', 'Øre', '', '!!');
const text = fc.array(word, { maxLength: 4 }).map((words) => words.join(' '));
const entry = fc.record({
  text: fc.record({ title: text, tags: fc.array(text, { maxLength: 2 }) }, { requiredKeys: [] }),
  removed: fc.boolean(),
});
const stopWords = fc.subarray(['the', 'and', 'owl']);
const limits = fc.record(
  {
    maxQueryLength: fc.integer({ min: 1, max: 40 }),
    maxQueryTerms: fc.integer({ min: 1, max: 4 }),
    maxExpansions: fc.integer({ min: 1, max: 6 }),
  },
  { requiredKeys: [] },
);
const queryTerm = fc.oneof(
  word,
  word.map((value) => value.slice(0, 2)),
  fc.constantFrom('fxo', 'nigth', 'ore', 'oxe'),
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

describe('FR-12 an index loaded from its own snapshot', () => {
  test.each(TRANSPORTS)(
    'after %s writes the same snapshot and answers every search like the original',
    (_, transport) => {
      fc.assert(
        fc.property(
          fc.array(entry, { maxLength: 6 }),
          stopWords,
          limits,
          query,
          searchOptions,
          (entries, stopped, limited, searched, options) => {
            const original = createIndex<Card>({
              idKey: 'id',
              keys: [{ path: 'title', weight: 2 }, 'tags'],
              stopWords: stopped,
              limits: limited,
            });
            original.addAll(entries.map(({ text: values }, position) => ({ ...values, id: position })));
            for (const [position, { removed }] of entries.entries()) {
              if (removed) {
                original.remove(position);
              }
            }
            const snapshot = original.toJSON();

            const loaded = loadIndex<Card>(transport(snapshot));

            expect(loaded.toJSON()).toEqual(snapshot);
            const truncated = { ...options, truncateQuery: true };
            expect(loaded.search(searched, truncated)).toEqual(original.search(searched, truncated));
          },
        ),
        { numRuns: RUNS },
      );
    },
  );
});
