import { describe, expect, test } from 'vitest';
import { tokenize, validateSpans } from '../../../src/core/tokenize.ts';

const invalidTokenSpan: unknown = expect.objectContaining({ name: 'TyposeekError', code: 'INVALID_TOKEN_SPAN' });

function* unendingSpans(onRead: () => void): Generator<{ start: number; end: number }> {
  for (let start = 0; ; start += 1) {
    onRead();
    yield { start, end: start + 1 };
  }
}

describe('tokenize', () => {
  test.each([
    { text: ' ,.-!? ', spans: [] },
    {
      text: 'Hello, wörld-42',
      spans: [
        { start: 0, end: 5 },
        { start: 7, end: 12 },
        { start: 13, end: 15 },
      ],
    },
    {
      text: 'café ดี',
      spans: [
        { start: 0, end: 5 },
        { start: 6, end: 8 },
      ],
    },
    {
      text: "𝐀b don't",
      spans: [
        { start: 0, end: 3 },
        { start: 4, end: 7 },
        { start: 8, end: 9 },
      ],
    },
  ])('splits $text into letter, number and mark runs at UTF-16 offsets', ({ text, spans }) => {
    expect(tokenize(text)).toStrictEqual(spans);
  });
});

describe('validateSpans', () => {
  test('returns plain copies of ordered spans that touch both ends of the text and each other', () => {
    const spans = [
      { start: 0, end: 2, kind: 'word' },
      { start: 2, end: 4, kind: 'word' },
    ];

    expect(validateSpans(spans, 4)).toStrictEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  test.each([
    ['a string', 'ab'],
    ['null', null],
    ['an object without an iterator', {}],
    ['an object whose iterator is not a function', { [Symbol.iterator]: 1 }],
  ])('rejects %s as the tokenizer result', (_label, result) => {
    expect(() => validateSpans(result, 4)).toThrow(invalidTokenSpan);
  });

  test.each([
    ['a null span', [null]],
    ['a number span', [3]],
    ['a span without an end', [{ start: 0 }]],
    ['a span with a fractional start', [{ start: 0.5, end: 2 }]],
    ['a span with a fractional end', [{ start: 0, end: 1.5 }]],
    ['a span starting before the text', [{ start: -1, end: 1 }]],
    ['a span ending past the text', [{ start: 3, end: 5 }]],
    ['an empty span', [{ start: 1, end: 1 }]],
    [
      'an overlapping span',
      [
        { start: 0, end: 2 },
        { start: 1, end: 3 },
      ],
    ],
  ])('rejects %s', (_label, spans) => {
    expect(() => validateSpans(spans, 4)).toThrow(invalidTokenSpan);
  });

  test('stops an endless iterator at the first span past the text length', () => {
    let reads = 0;
    const textLength = 3;

    expect(() =>
      validateSpans(
        unendingSpans(() => {
          reads += 1;
        }),
        textLength,
      ),
    ).toThrow(invalidTokenSpan);
    expect(reads).toBe(textLength + 1);
  });
});
