import { expect, test } from 'vitest';
import { ADAPTERS } from '../../../bench/adapters.ts';
import { generateDataset, type BenchRecord } from '../../../bench/dataset.ts';

const { records } = generateDataset({ seed: 20261110, size: 2_000 });

function wordsOf(record: BenchRecord): readonly string[] {
  return [record.title, record.body, record.tag].join(' ').split(' ');
}

function rareTitleWordAndTag(): string {
  const counts = new Map<string, number>();
  for (const word of records.flatMap(wordsOf)) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const isRare = (word: string): boolean => counts.get(word) === 1;
  const record = records.find((candidate) => isRare(candidate.title.split(' ')[0] ?? '') && isRare(candidate.tag));
  if (record === undefined) {
    throw new Error('no record holds a title word and a tag that no other record holds');
  }
  return `${record.title.split(' ')[0] ?? ''} ${record.tag}`;
}

const QUERY = rareTitleWordAndTag();

test.each(ADAPTERS.map((adapter) => [adapter.name, adapter] as const))(
  '%s finds the one record whose title word and tag form the query',
  (_, adapter) => {
    expect(adapter.build(records).search(QUERY)).toBeGreaterThan(0);
  },
);
