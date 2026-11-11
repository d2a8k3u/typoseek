import { TyposeekError } from './core/errors';
import type { TokenSpan, Tokenizer } from './types';

interface SegmenterRuntime {
  readonly Segmenter?: typeof Intl.Segmenter;
}

function availableSegmenter(): typeof Intl.Segmenter {
  const runtime: SegmenterRuntime = Intl;
  const { Segmenter } = runtime;
  if (typeof Segmenter !== 'function') {
    throw new TyposeekError('SEGMENTER_UNAVAILABLE', 'Intl.Segmenter is not available in this runtime');
  }
  return Segmenter;
}

/** @public */
export function createSegmenterTokenizer(locales?: string | readonly string[]): Tokenizer {
  const Segmenter = availableSegmenter();
  const segmenter = new Segmenter(locales, { granularity: 'word' });
  return function* wordSpans(text: string): Generator<TokenSpan, undefined> {
    for (const { segment, index, isWordLike } of segmenter.segment(text)) {
      if (isWordLike === true) {
        yield { start: index, end: index + segment.length };
      }
    }
    return undefined;
  };
}

export type { TokenSpan, Tokenizer } from './types';
