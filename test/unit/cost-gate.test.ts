import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { generateDataset, type BenchRecord } from '../../bench/dataset.ts';
import { generateQueries } from '../../bench/queries.ts';
import { expandTerm } from '../../src/core/expand.ts';
import { createIndex } from '../../src/index.ts';

vi.mock(import('../../src/core/expand.ts'), async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, expandTerm: vi.fn(original.expandTerm) as typeof original.expandTerm };
});

const SEED = 20261110;

const DATASET_SIZE = 10_000;

const GATED_QUERY_COUNT = 50;

const BUDGET_URL = new URL('cost-budget.json', import.meta.url);

const COUNTERS = ['dpRows', 'infixChecks'] as const;

type Counter = (typeof COUNTERS)[number];

interface CounterBudget {
  readonly perQuery: readonly number[];
  readonly total: number;
}

type CostBudget = Readonly<Record<Counter, CounterBudget>>;

interface QueryCost {
  readonly dpRows: number;
  readonly infixChecks: number;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function counterBudget(value: unknown, counter: Counter): CounterBudget {
  const { perQuery, total } = (typeof value === 'object' && value !== null ? value : {}) as Partial<
    Record<keyof CounterBudget, unknown>
  >;
  if (
    !Array.isArray(perQuery) ||
    perQuery.length !== GATED_QUERY_COUNT ||
    !perQuery.every(isCount) ||
    !isCount(total)
  ) {
    throw new TypeError(
      `cost-budget.json ${counter} must hold perQuery, ${String(GATED_QUERY_COUNT)} counts, and a count total`,
    );
  }
  return { perQuery, total };
}

function committedBudget(): CostBudget {
  const parsed = JSON.parse(readFileSync(BUDGET_URL, 'utf8')) as Partial<Record<Counter, unknown>>;
  return {
    dpRows: counterBudget(parsed.dpRows, 'dpRows'),
    infixChecks: counterBudget(parsed.infixChecks, 'infixChecks'),
  };
}

function measuredCosts(): readonly QueryCost[] {
  const dataset = generateDataset({ seed: SEED, size: DATASET_SIZE });
  const index = createIndex<BenchRecord>({ idKey: 'id', keys: ['title', 'body', 'tag'] });
  index.addAll(dataset.records);
  const expand = vi.mocked(expandTerm);
  return generateQueries(dataset, { seed: SEED, count: GATED_QUERY_COUNT }).map((query) => {
    expand.mockClear();
    index.search(query.text);
    return expand.mock.results.reduce(
      (sum, result) =>
        result.type === 'return'
          ? { dpRows: sum.dpRows + result.value.dpRows, infixChecks: sum.infixChecks + result.value.infixChecks }
          : sum,
      { dpRows: 0, infixChecks: 0 },
    );
  });
}

test('expands the first 50 benchmark queries within the committed DP row and infix check budget per query and in total', () => {
  const costs = measuredCosts();
  const budget = committedBudget();
  const overBudget = COUNTERS.flatMap((counter) => {
    const measured = costs.map((cost) => cost[counter]);
    const total = measured.reduce((sum, count) => sum + count, 0);
    const queries = measured.flatMap((count, query) => {
      const allowed = budget[counter].perQuery[query] ?? 0;
      return count > allowed ? [{ counter, query, measured: count, allowed }] : [];
    });
    return total > budget[counter].total
      ? [...queries, { counter, query: 'total', measured: total, allowed: budget[counter].total }]
      : queries;
  });

  expect(overBudget).toEqual([]);
});
