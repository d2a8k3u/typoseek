import { describe, expect, test } from 'vitest';
import { invariantViolation, isTyposeekError, TyposeekError } from '../../../src/core/errors.ts';

class ForeignTyposeekError extends Error {
  override readonly name = 'TyposeekError';
  readonly code = 'DUPLICATE_ID';
}

describe('TyposeekError', () => {
  test('carries its code, message and name without a record index', () => {
    const error = new TyposeekError('INVALID_OPTION', 'limit must be a positive integer');

    expect(error).toMatchObject({
      name: 'TyposeekError',
      code: 'INVALID_OPTION',
      message: 'limit must be a positive integer',
      recordIndex: undefined,
    });
    expect(error).toBeInstanceOf(Error);
    expect(Object.hasOwn(error, 'cause')).toBe(false);
  });

  test('carries the record index and cause from its details', () => {
    const reason = { aborted: 'by caller' };

    const error = new TyposeekError('ABORTED', 'addAllAsync was aborted', { recordIndex: 3, cause: reason });

    expect(error.recordIndex).toBe(3);
    expect(error.cause).toBe(reason);
  });
});

describe('isTyposeekError', () => {
  test('recognises an error of another package copy by its name and code', () => {
    const foreign = new ForeignTyposeekError('id already indexed');

    expect(foreign).not.toBeInstanceOf(TyposeekError);
    expect(isTyposeekError(foreign)).toBe(true);
    expect(isTyposeekError(new TyposeekError('UNKNOWN_ID', 'id is not indexed'))).toBe(true);
  });

  test.each([
    ['null', null],
    ['the name as a string', 'TyposeekError'],
    ['an error with another name and a valid code', Object.assign(new Error('other'), { code: 'INVALID_ID' })],
    ['an object with the name but no code', { name: 'TyposeekError' }],
    ['an object with the name and a non-string code', { name: 'TyposeekError', code: 7 }],
    ['an object with the name and an Object.prototype member as code', { name: 'TyposeekError', code: 'toString' }],
  ])('rejects %s', (_label, value) => {
    expect(isTyposeekError(value)).toBe(false);
  });
});

describe('invariantViolation', () => {
  test('returns a plain Error, not a TyposeekError, with the invariant prefix before the detail', () => {
    const error = invariantViolation('stream references unknown surface id 7');

    expect(error).toStrictEqual(new Error('typoseek invariant violated: stream references unknown surface id 7'));
  });
});
