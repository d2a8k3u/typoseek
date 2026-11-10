import { invariantViolation } from '../core/errors';
import { resolveText } from '../core/paths';
import { validateSpans } from '../core/tokenize';
import type { FieldMatch, Range, TokenSpan } from '../types';
import type { RankedRecord } from './execute';
import { indexedDoc, knownSurface, valueRuns, type IndexState } from './state';

const CHANGED_VALUE_PROBLEM =
  'a highlighted value no longer holds the tokens it was indexed with; either the tokenizer is impure, or the record changed after indexing without update';

function indexedSpans<T>(state: IndexState<T>, value: string | undefined, slots: Int32Array): readonly TokenSpan[] {
  if (value === undefined) {
    throw invariantViolation(CHANGED_VALUE_PROBLEM);
  }
  const spans = validateSpans(state.config.pipeline.tokenize(value), value.length);
  const surfaces = Array.from(slots, (surfaceId) => knownSurface(state, surfaceId).surface);
  const holdsIndexedTokens =
    spans.length === surfaces.length &&
    spans.every((span, position) => value.slice(span.start, span.end) === surfaces[position]);
  if (!holdsIndexedTokens) {
    throw invariantViolation(CHANGED_VALUE_PROBLEM);
  }
  return spans;
}

function matchPredicate<T>(state: IndexState<T>, ranked: RankedRecord): (surfaceId: number) => boolean {
  const { matchedTerms, matchedSurfaceIds } = ranked;
  if (matchedSurfaceIds !== undefined) {
    return (surfaceId) => matchedSurfaceIds.has(surfaceId);
  }
  return (surfaceId) => {
    const { term } = knownSurface(state, surfaceId);
    return term !== undefined && matchedTerms.has(term);
  };
}

export function highlightRecord<T>(state: IndexState<T>, ranked: RankedRecord): readonly FieldMatch[] {
  const { fields } = state.config;
  const { item, stream } = indexedDoc(state, ranked.docNum);
  const isMatched = matchPredicate(state, ranked);
  const matches: FieldMatch[] = [];
  let resolvedFieldIndex = -1;
  let values: readonly string[] = [];
  for (const run of valueRuns(stream, fields)) {
    const matchedSlots = Array.from(run.slots, isMatched);
    if (!matchedSlots.includes(true)) {
      continue;
    }
    if (run.fieldIndex !== resolvedFieldIndex) {
      values = resolveText(item, run.field.segments);
      resolvedFieldIndex = run.fieldIndex;
    }
    const ranges = indexedSpans(state, values[run.valueIndex], run.slots)
      .filter((_, position) => matchedSlots[position] === true)
      .map((span): Range => [span.start, span.end]);
    matches.push({ key: run.field.path, valueIndex: run.valueIndex, ranges });
  }
  return matches;
}
