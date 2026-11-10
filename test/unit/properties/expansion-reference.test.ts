import fc from 'fast-check';
import { expect, test } from 'vitest';
import { expandTerm, INFIX_SCAN_PER_EXPANSION, type ExpansionPolicy } from '../../../src/core/expand.ts';
import { gramLists, referenceExpansion, vocabularyTree } from '../../support/reference.ts';

const RUNS = 1_000;
const GRAM_CHUNK_CAPACITY = 512;
const MAX_VOCABULARY_SIZE = 60;
const MAX_TERM_LENGTH = 9;
const MAX_QUERY_LENGTH = 10;
const TERMS_BUILT_AROUND_THE_QUERY = 3;
const CAP_ABOVE_VOCABULARY = MAX_VOCABULARY_SIZE + TERMS_BUILT_AROUND_THE_QUERY + 1;

const letter = fc.oneof(
  { weight: 8, arbitrary: fc.constantFrom('a', 'b', 'c') },
  { weight: 1, arbitrary: fc.constantFrom('é', '𝐀', '\ud835', '\udc00') },
);
const word = (maxLength: number) => fc.string({ unit: letter, minLength: 1, maxLength });

const vocabulary = fc.array(word(MAX_TERM_LENGTH), { maxLength: MAX_VOCABULARY_SIZE });

const partOfATerm = fc.tuple(word(MAX_TERM_LENGTH), fc.nat(), fc.nat()).map(([term, start, length]) => {
  const characters = Array.from(term);
  const from = start % characters.length;
  return characters.slice(from, from + 1 + (length % (characters.length - from))).join('');
});

const vocabularyAndQuery = fc
  .tuple(vocabulary, partOfATerm, word(MAX_QUERY_LENGTH), fc.boolean())
  .map(([terms, part, unrelated, queryIsPartOfATerm]) => ({
    terms: [...terms, `${part}a`, `b${part}`, `ab${part}c`],
    query: queryIsPartOfATerm ? part : unrelated,
  }));

const policy: fc.Arbitrary<ExpansionPolicy> = fc.record({
  maxEdits: fc.constantFrom(0, 1, 2),
  prefix: fc.boolean(),
  infix: fc.boolean(),
  maxExpansions: fc.oneof(fc.integer({ min: 1, max: 8 }), fc.constant(CAP_ABOVE_VOCABULARY)),
});

const chunkLengths = fc.array(fc.integer({ min: 1, max: GRAM_CHUNK_CAPACITY }), { minLength: 1, maxLength: 8 });
const shortChunkLengths = fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 1, maxLength: 8 });

test('expansion equals a brute-force scan of the vocabulary, whatever the chunk boundaries of the gram lists', () => {
  fc.assert(
    fc.property(
      vocabularyAndQuery,
      policy,
      fc.oneof(chunkLengths, shortChunkLengths),
      ({ terms, query }, expansionPolicy, lengths) => {
        const tree = vocabularyTree(terms);

        const { expansions, infixChecks } = expandTerm(
          tree.root,
          gramLists(tree, terms, lengths),
          query,
          expansionPolicy,
        );

        expect(
          expansions.map(({ term, kind, distance, firstCharTypo }) => ({ term, kind, distance, firstCharTypo })),
        ).toEqual(referenceExpansion(terms, query, expansionPolicy));
        expect(expansions.map(({ value }) => value)).toEqual(expansions.map(({ term }) => tree.get(term)));
        expect(infixChecks).toBeLessThanOrEqual(INFIX_SCAN_PER_EXPANSION * expansionPolicy.maxExpansions);
      },
    ),
    { numRuns: RUNS },
  );
});
