import { describe, expect, test } from 'vitest';
import { generateDataset } from '../../../bench/dataset.ts';
import { generateQueries, type QueryTerm } from '../../../bench/queries.ts';
import { osaDistance } from '../../../src/core/distance.ts';

const DATASET = generateDataset({ seed: 20261110, size: 10_000 });

function codePoints(text: string): readonly string[] {
  return Array.from(text);
}

function holdsInnerSubstring(source: string, part: string): boolean {
  const sourcePoints = codePoints(source);
  const partPoints = codePoints(part);
  return sourcePoints.some(
    (_, start) =>
      start > 0 &&
      partPoints.length <= sourcePoints.length - start &&
      partPoints.every((point, offset) => sourcePoints[start + offset] === point),
  );
}

const MATCHES_KIND: Readonly<Record<QueryTerm['kind'], (term: QueryTerm) => boolean>> = {
  unchanged: ({ source, text }) => text === source,
  oneEdit: ({ source, text }) => osaDistance(source, text) === 1,
  twoEdits: ({ source, text }) => codePoints(source).length >= 8 && osaDistance(source, text) === 2,
  prefix: ({ source, text }) =>
    source.startsWith(text) && codePoints(text).length >= 2 && codePoints(text).length < codePoints(source).length,
  infix: ({ source, text }) => codePoints(text).length >= 3 && text !== source && holdsInnerSubstring(source, text),
};

describe('generateQueries', () => {
  test('returns the same queries for the same seed, so the first 50 of 200 are the 50 of a count of 50', () => {
    const queries = generateQueries(DATASET, { seed: 20261110, count: 200 });

    expect(generateQueries(DATASET, { seed: 20261110, count: 50 })).toEqual(queries.slice(0, 50));
    expect(generateQueries(DATASET, { seed: 20261111, count: 50 })).not.toEqual(queries.slice(0, 50));
  });

  test('builds 2 or 3 terms from record words, each changed as its kind says, prefix and infix only on the last term', () => {
    const queries = generateQueries(DATASET, { seed: 20261110, count: 2_000 });
    const recordWords = new Set(
      DATASET.records.flatMap((record) => [record.title, record.body, record.tag].join(' ').split(' ')),
    );
    const misfits = queries.flatMap((query) =>
      query.terms.flatMap((term, position) => {
        const isLast = position === query.terms.length - 1;
        const positional = term.kind === 'prefix' || term.kind === 'infix';
        return recordWords.has(term.source) && MATCHES_KIND[term.kind](term) && (isLast || !positional)
          ? []
          : [{ query: query.text, term }];
      }),
    );

    expect(new Set(queries.map((query) => query.terms.length))).toEqual(new Set([2, 3]));
    expect(queries.filter((query) => query.text !== query.terms.map((term) => term.text).join(' '))).toEqual([]);
    expect(misfits).toEqual([]);
  });

  test('draws the last term 40% unchanged, 25% one edit, 20% two edits, 10% prefix, 5% infix, earlier terms 40:25:20 of the first three', () => {
    const queries = generateQueries(DATASET, { seed: 20261110, count: 8_000 });
    const shares = (terms: readonly QueryTerm[]): Readonly<Record<QueryTerm['kind'], number>> => {
      const share = (kind: QueryTerm['kind']): number =>
        terms.filter((term) => term.kind === kind).length / terms.length;
      return {
        unchanged: share('unchanged'),
        oneEdit: share('oneEdit'),
        twoEdits: share('twoEdits'),
        prefix: share('prefix'),
        infix: share('infix'),
      };
    };
    const lastTerms = queries.flatMap((query) => query.terms.slice(-1));
    const earlierTerms = queries.flatMap((query) => query.terms.slice(0, -1));
    const closeTo = (expected: number): unknown =>
      expect.toSatisfy((share: number) => Math.abs(share - expected) < 0.02);

    expect(shares(lastTerms)).toEqual({
      unchanged: closeTo(0.4),
      oneEdit: closeTo(0.25),
      twoEdits: closeTo(0.2),
      prefix: closeTo(0.1),
      infix: closeTo(0.05),
    });
    expect(shares(earlierTerms)).toEqual({
      unchanged: closeTo(40 / 85),
      oneEdit: closeTo(25 / 85),
      twoEdits: closeTo(20 / 85),
      prefix: 0,
      infix: 0,
    });
  });
});
