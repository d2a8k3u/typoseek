import { afterEach, describe, expect, test, vi } from 'vitest';
import { createIndex } from '../../../src/index.ts';
import { createSegmenterTokenizer, type Tokenizer } from '../../../src/segmenter.ts';
import type { FieldMatch, IndexHit, SearchResponse } from '../../../src/types.ts';

interface Sentence {
  readonly id: number;
  readonly text: string;
}

interface HitSummary {
  readonly id: unknown;
  readonly matches: readonly FieldMatch[];
}

function summary(response: SearchResponse<IndexHit<Sentence>>): readonly HitSummary[] {
  return response.hits.map(({ id, matches }) => ({ id, matches }));
}

function searchSentences(tokenize: Tokenizer, texts: readonly string[], query: string): readonly HitSummary[] {
  const index = createIndex<Sentence>({ idKey: 'id', keys: ['text'], tokenize });
  index.addAll(texts.map((text, position) => ({ id: position + 1, text })));
  return summary(index.search(query));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FR-15 createSegmenterTokenizer', () => {
  test('finds a Japanese word inside a sentence without spaces and highlights only that word', () => {
    const texts = ['東京の天気は晴れです', '大阪で天ぷらを食べました', '京都の寺を訪ねる'];

    expect(searchSentences(createSegmenterTokenizer('ja'), texts, '天気')).toEqual([
      { id: 1, matches: [{ key: 'text', valueIndex: 0, ranges: [[3, 5]] }] },
    ]);
  });

  test('finds a Thai word inside sentences without spaces and highlights only that word', () => {
    const texts = ['แมวนอนบนเตียง', 'หมากินข้าวในบ้าน', 'นกบินบนท้องฟ้า'];

    expect(searchSentences(createSegmenterTokenizer(['th']), texts, 'บน')).toEqual([
      { id: 1, matches: [{ key: 'text', valueIndex: 0, ranges: [[6, 8]] }] },
      { id: 3, matches: [{ key: 'text', valueIndex: 0, ranges: [[5, 7]] }] },
    ]);
  });

  test('yields spans for word segments only, skipping spaces and punctuation', () => {
    expect(Array.from(createSegmenterTokenizer('en')('red fox, owl!'))).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 9, end: 12 },
    ]);
  });

  test('throws SEGMENTER_UNAVAILABLE when the runtime has no Intl.Segmenter', () => {
    vi.stubGlobal('Intl', { ...Intl, Segmenter: undefined });

    expect(() => createSegmenterTokenizer('ja')).toThrow(
      expect.objectContaining({ name: 'TyposeekError', code: 'SEGMENTER_UNAVAILABLE' }),
    );
  });

  test('lets the RangeError of an invalid locale through unchanged', () => {
    expect(() => createSegmenterTokenizer('en_US')).toThrow(RangeError);
  });
});
