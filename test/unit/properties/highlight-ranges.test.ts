import fc from 'fast-check';
import { expect, test } from 'vitest';
import { foldTerm } from '../../../src/core/fold.ts';
import { tokenize } from '../../../src/core/tokenize.ts';
import type { IndexHit, SearchResponse } from '../../../src/types.ts';
import { buildState, searchState } from '../../support/engine.ts';
import { editMatrixBoundedPrefixDistance } from '../../support/reference.ts';

const RUNS = 10_000;
const WHOLE_RESULT = 1000;
const MIN_LENGTH_FOR_ONE_TYPO = 4;
const MIN_LENGTH_FOR_TWO_TYPOS = 8;
const MIN_INFIX_LENGTH = 3;

const unit = fc.constantFrom('a', 'b', 'e', 'ß', 'ﬁ', '́', 'É', '𝐀', '😀', ' ', '-');
const text = fc.string({ unit, maxLength: 12 });

const corpusAndQuery = fc.array(text, { minLength: 1, maxLength: 4 }).chain((texts) =>
  fc.record({
    texts: fc.constant(texts),
    query: fc.oneof(fc.string({ unit, minLength: 1, maxLength: 8 }), fc.constantFrom(...texts)),
    fold: fc.boolean(),
    mode: fc.constantFrom('and' as const, 'or' as const),
  }),
);

interface Note {
  readonly id: number;
  readonly text: string;
}

function foldedQueryTerms(query: string): readonly string[] {
  return tokenize(query)
    .map((span) => foldTerm(query.slice(span.start, span.end)))
    .filter((term) => term !== '');
}

function maxEditsFor(term: string): number {
  const length = Array.from(term).length;
  if (length >= MIN_LENGTH_FOR_TWO_TYPOS) {
    return 2;
  }
  return length >= MIN_LENGTH_FOR_ONE_TYPO ? 1 : 0;
}

function holdsAfterFirstCodePoint(term: string, part: string): boolean {
  const [first = ''] = term;
  return term.slice(first.length).includes(part);
}

function isMatchedBy(queryTerm: string, term: string): boolean {
  return (
    editMatrixBoundedPrefixDistance(queryTerm, term, maxEditsFor(queryTerm)) !== undefined ||
    (Array.from(queryTerm).length >= MIN_INFIX_LENGTH && holdsAfterFirstCodePoint(term, queryTerm))
  );
}

function rangeViolations(
  notes: readonly Note[],
  queryTerms: readonly string[],
  response: SearchResponse<IndexHit<Note>>,
): readonly string[] {
  return response.hits.flatMap((hit) => {
    const original = notes[Number(hit.id)]?.text ?? '';
    return hit.matches.flatMap((match) => {
      let previousEnd = 0;
      return match.ranges.flatMap(([start, end]) => {
        const inOrder = start >= previousEnd && end > start && end <= original.length;
        previousEnd = end;
        const folded = foldTerm(original.slice(start, end));
        const matched = queryTerms.some((queryTerm) => isMatchedBy(queryTerm, folded));
        return inOrder && matched && match.valueIndex === 0
          ? []
          : [`${String(hit.id)}: [${String(start)}, ${String(end)})`];
      });
    });
  });
}

test('FR-5 every range lies inside the original value, ranges of a value do not overlap, and each folds to a term the query matched', () => {
  fc.assert(
    fc.property(corpusAndQuery, ({ texts, query, fold, mode }) => {
      const notes = texts.map((original, id) => ({ id, text: original }));
      const response = searchState(buildState(notes, { keys: ['text'] }), query, { fold, mode, limit: WHOLE_RESULT });

      expect(rangeViolations(notes, foldedQueryTerms(query), response)).toEqual([]);
    }),
    { numRuns: RUNS },
  );
});
