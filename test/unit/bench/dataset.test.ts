import { describe, expect, test } from 'vitest';
import { generateDataset } from '../../../bench/dataset.ts';
import { foldTerm } from '../../../src/core/fold.ts';

const FOLDED_WORD = /^[a-z]{3,12}$/;

function countBy<K>(keys: readonly K[]): ReadonlyMap<K, number> {
  const counts = new Map<K, number>();
  for (const key of keys) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

describe('generateDataset', () => {
  test('returns the same dataset for the same seed and another one for another seed', () => {
    const dataset = generateDataset({ seed: 20261110, size: 50 });

    expect(generateDataset({ seed: 20261110, size: 50 })).toEqual(dataset);
    expect(generateDataset({ seed: 20261111, size: 50 }).records).not.toEqual(dataset.records);
  });

  test('builds a vocabulary of 50,000 distinct words of 3 to 12 letters, length uniform, 10% with Czech diacritics that fold to a to z', () => {
    const { vocabulary } = generateDataset({ seed: 7, size: 1 });
    const folded = vocabulary.map(foldTerm);
    const lengthCounts = countBy(folded.map((word) => word.length));
    const diacriticShare = vocabulary.filter((word, index) => word !== folded[index]).length / vocabulary.length;

    expect(vocabulary).toHaveLength(50_000);
    expect(new Set(folded).size).toBe(50_000);
    expect(folded.filter((word) => !FOLDED_WORD.test(word))).toEqual([]);
    expect([...lengthCounts.keys()].sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(Math.min(...lengthCounts.values())).toBeGreaterThan(4_500);
    expect(Math.max(...lengthCounts.values())).toBeLessThan(5_500);
    expect(diacriticShare).toBeGreaterThan(0.09);
    expect(diacriticShare).toBeLessThan(0.11);
  });

  test('builds size records with distinct ids, a title of 3 to 5 words, a body of 5 to 7 words and a tag of 1 word, all from the vocabulary', () => {
    const { vocabulary, records } = generateDataset({ seed: 7, size: 2_000 });
    const known = new Set(vocabulary);
    const wordCounts = (field: 'title' | 'body' | 'tag'): readonly number[] =>
      [...new Set(records.map((record) => record[field].split(' ').length))].sort((a, b) => a - b);
    const unknownWords = records
      .flatMap((record) => [record.title, record.body, record.tag].join(' ').split(' '))
      .filter((word) => !known.has(word));

    expect(records).toHaveLength(2_000);
    expect(new Set(records.map((record) => record.id)).size).toBe(2_000);
    expect(wordCounts('title')).toEqual([3, 4, 5]);
    expect(wordCounts('body')).toEqual([5, 6, 7]);
    expect(wordCounts('tag')).toEqual([1]);
    expect(unknownWords).toEqual([]);
  });

  test('draws record words with Zipf frequencies of s = 1 over the vocabulary order', () => {
    const { vocabulary, records } = generateDataset({ seed: 7, size: 10_000 });
    const counts = countBy(records.flatMap((record) => [record.title, record.body, record.tag].join(' ').split(' ')));
    const occurrences = (rank: number): number => counts.get(vocabulary[rank - 1] ?? '') ?? 0;

    expect(occurrences(1) / occurrences(2)).toBeGreaterThan(1.8);
    expect(occurrences(1) / occurrences(2)).toBeLessThan(2.2);
    expect(occurrences(1) / occurrences(10)).toBeGreaterThan(8.5);
    expect(occurrences(1) / occurrences(10)).toBeLessThan(11.5);
  });
});
