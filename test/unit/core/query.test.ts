import { describe, expect, test } from 'vitest';
import { parseQuery, type QueryClause } from '../../../src/core/query.ts';

function term(text: string, negated = false): QueryClause {
  return { kind: 'term', negated, text };
}

function phrase(text: string, negated = false): QueryClause {
  return { kind: 'phrase', negated, text };
}

describe('parseQuery', () => {
  test.each<[string, string, readonly QueryClause[]]>([
    ['any whitespace separates terms', ' foo\tbar　baz\n', [term('foo'), term('bar'), term('baz')]],
    ['straight quotes enclose a phrase', '"foo bar" baz', [phrase('foo bar'), term('baz')]],
    ['curly quotes enclose a phrase', '“foo bar”', [phrase('foo bar')]],
    ['low and reversed quotes enclose a phrase', '„foo bar‟', [phrase('foo bar')]],
    ['guillemets enclose a phrase', '«foo bar»', [phrase('foo bar')]],
    [
      'a quote inside a word starts and ends a phrase',
      'foo"bar baz"qux',
      [term('foo'), phrase('bar baz'), term('qux')],
    ],
    ['an unclosed phrase runs to the end', 'baz "foo bar', [term('baz'), phrase('foo bar')]],
    ['a double prime is plain text', '″foo bar″', [term('″foo'), term('bar″')]],
    ['a hyphen negates a term', '-foo bar', [term('foo', true), term('bar')]],
    ['a minus sign negates a term', '−foo', [term('foo', true)]],
    ['a hyphen negates a phrase', '-"foo bar"', [phrase('foo bar', true)]],
    ['a hyphen inside a term is text', 'foo-bar', [term('foo-bar')]],
    ['only the first of two hyphens negates', '--foo', [term('-foo', true)]],
    ['a lone hyphen and an empty phrase give no clause', 'foo - "" -""', [term('foo')]],
  ])('%s', (_label, query, clauses) => {
    expect(parseQuery(query)).toStrictEqual(clauses);
  });
});
