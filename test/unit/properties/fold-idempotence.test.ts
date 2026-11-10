import fc from 'fast-check';
import { expect, test } from 'vitest';
import { foldTerm } from '../../../src/core/fold.ts';
import { codePointString } from '../../support/arbitraries.ts';

const RUNS = 10_000;

test('folding the output of folding returns the same string for code points across the whole range', () => {
  fc.assert(
    fc.property(codePointString, (text) => {
      const folded = foldTerm(text);

      expect(foldTerm(folded)).toBe(folded);
    }),
    { numRuns: RUNS },
  );
});
