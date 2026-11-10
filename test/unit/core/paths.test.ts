import { runInNewContext } from 'node:vm';
import { describe, expect, test } from 'vitest';
import { parseKeyPath, resolveText, resolveValues } from '../../../src/core/paths.ts';

describe('parseKeyPath', () => {
  test.each([
    ['one segment', 'title', ['title']],
    ['five segments', 'a.b.c.d.e', ['a', 'b', 'c', 'd', 'e']],
  ])('splits a path of %s at dots', (_label, path, segments) => {
    expect(parseKeyPath(path)).toEqual(segments);
  });

  test.each([
    ['six segments', 'a.b.c.d.e.f'],
    ['the empty path', ''],
    ['an empty inner segment', 'a..b'],
    ['an empty last segment', 'a.'],
    ['__proto__', '__proto__'],
    ['constructor as an inner segment', 'a.constructor.b'],
    ['prototype as the last segment', 'a.prototype'],
  ])('rejects %s', (_label, path) => {
    expect(parseKeyPath(path)).toBeUndefined();
  });
});

describe('resolveText', () => {
  test.each([
    ['a nested object path', { a: { b: { c: 'deep' } } }, ['a', 'b', 'c'], ['deep']],
    ['an array of strings', { tags: ['red', 'blue'] }, ['tags'], ['red', 'blue']],
    [
      'nested arrays depth-first in index order',
      { groups: [{ tags: ['a', ['b', 'c']] }, [{ tags: 'd' }]] },
      ['groups', 'tags'],
      ['a', 'b', 'c', 'd'],
    ],
    [
      'number leaves as text, counting only string and finite-number leaves',
      { values: ['x', 1.5, null, true, Number.NaN, Infinity, { v: 'object' }, undefined, -0, 'y'] },
      ['values'],
      ['x', '1.5', '0', 'y'],
    ],
    ['the record itself for zero segments', 'whole', [], ['whole']],
    ['nothing for a missing property', { a: {} }, ['a', 'b'], []],
    ['nothing through a null', { a: null }, ['a', 'b'], []],
    ['nothing through a string', { a: 'text' }, ['a', 'length'], []],
    ['nothing from an inherited property', Object.create({ title: 'inherited' }) as unknown, ['title'], []],
  ])('resolves %s', (_label, record, segments, values) => {
    expect(resolveText(record, segments)).toEqual(values);
  });

  test('skips an array already visited, so a cyclic array resolves once', () => {
    const cyclic: unknown[] = ['before'];
    cyclic.push(cyclic, 'after');

    expect(resolveText({ tags: cyclic }, ['tags'])).toEqual(['before', 'after']);
  });
});

describe('resolveValues', () => {
  test('keeps strings, finite numbers, booleans, null and valid Dates from any realm, and nothing else', () => {
    const leaves = [
      's',
      2,
      false,
      null,
      new Date(5),
      runInNewContext('new Date(9)'),
      new Date(Number.NaN),
      Number.NaN,
      Infinity,
      {},
      { getTime: () => 7 },
      undefined,
    ];

    expect(resolveValues({ leaves }, ['leaves'])).toEqual(['s', 2, false, null, { dateMs: 5 }, { dateMs: 9 }]);
  });

  test('yields no value for an object that only claims to be a Date through Symbol.toStringTag', () => {
    expect(resolveValues({ at: { [Symbol.toStringTag]: 'Date' } }, ['at'])).toEqual([]);
  });
});
