import { describe, expect, test } from 'vitest';
import { boundedOsaDistance, boundedPrefixDistance, osaDistance } from '../../../src/core/distance.ts';

describe('osaDistance', () => {
  test.each([
    ['', 'abc', 3],
    ['abc', '', 3],
    ['abc', 'abd', 1],
    ['abc', 'abxc', 1],
    ['abxc', 'abc', 1],
    ['ab', 'ba', 1],
    ['abcd', 'acbd', 1],
    ['ca', 'abc', 3],
    ['kitten', 'sitting', 3],
    ['a', '𝐀', 1],
    ['𝐀b', 'b𝐀', 1],
  ])('counts %s to %s as %i edits', (a, b, distance) => {
    expect(osaDistance(a, b)).toBe(distance);
  });
});

describe('boundedOsaDistance', () => {
  test.each([
    ['abc', 'xyc', 2, 2],
    ['abc', 'xyz', 2, undefined],
    ['abc', 'abcde', 2, 2],
    ['abc', 'abcde', 1, undefined],
    ['𝐀b', 'b', 1, 1],
  ])('bounds %s to %s within %i edits at %s', (a, b, maxEdits, distance) => {
    expect(boundedOsaDistance(a, b, maxEdits)).toBe(distance);
  });
});

describe('boundedPrefixDistance', () => {
  test.each([
    ['typo', 'typoseek', 0, 0],
    ['tpyo', 'typoseek', 1, 1],
    ['abcd', 'abc', 1, 1],
    ['abcd', 'xabcdzzz', 1, 1],
    ['xyz', 'abcdefgh', 2, undefined],
  ])('bounds %s to the closest prefix of %s within %i edits at %s', (query, candidate, maxEdits, distance) => {
    expect(boundedPrefixDistance(query, candidate, maxEdits)).toBe(distance);
  });
});
