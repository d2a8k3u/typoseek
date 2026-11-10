import fc from 'fast-check';

const MAX_CODE_POINT = 0x10ffff;

const anyCodePoint = fc.integer({ min: 0, max: MAX_CODE_POINT }).map((codePoint) => String.fromCodePoint(codePoint));

export const codePointString = fc.string({ unit: anyCodePoint });
