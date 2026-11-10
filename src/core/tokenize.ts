import type { TokenSpan } from '../types';
import { TyposeekError } from './errors';

const TOKEN_PATTERN = /[\p{L}\p{N}\p{M}]+/gu;

/** @public */
export function tokenize(text: string): TokenSpan[] {
  return Array.from(text.matchAll(TOKEN_PATTERN), (match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

export function isIterableObject(value: unknown): value is Iterable<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Symbol.iterator in value &&
    typeof value[Symbol.iterator] === 'function'
  );
}

function hasOffsets(value: unknown): value is { readonly start: unknown; readonly end: unknown } {
  return typeof value === 'object' && value !== null && 'start' in value && 'end' in value;
}

function isOffset(value: unknown): value is number {
  return Number.isInteger(value);
}

function invalidSpan(message: string): TyposeekError {
  return new TyposeekError('INVALID_TOKEN_SPAN', message);
}

export function validateSpans(spans: unknown, textLength: number): readonly TokenSpan[] {
  if (!isIterableObject(spans)) {
    throw invalidSpan('tokenizer result must be an iterable object of spans');
  }
  const validated: TokenSpan[] = [];
  let previousEnd = 0;
  for (const span of spans) {
    const position = String(validated.length);
    if (!hasOffsets(span)) {
      throw invalidSpan(`token span ${position} must be an object with start and end`);
    }
    const { start, end } = span;
    if (!isOffset(start) || !isOffset(end)) {
      throw invalidSpan(`token span ${position} must have integer start and end`);
    }
    if (start < previousEnd || end <= start || end > textLength) {
      throw invalidSpan(
        `token span ${position} must be non-empty, ordered and inside text of length ${String(textLength)}`,
      );
    }
    validated.push({ start, end });
    previousEnd = end;
  }
  return validated;
}
