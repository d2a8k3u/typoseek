import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, cpus, release, totalmem, type, version } from 'node:os';
import { Bench } from 'tinybench';
import { createIndex, isTyposeekError } from 'typoseek';
import { ADAPTERS, type LibraryAdapter, type Searcher } from './adapters.ts';
import { generateDataset, type BenchRecord } from './dataset.ts';
import { median, nearestRank, slicePhase, type SlicePhase } from './measure.ts';
import { generateQueries, type BenchQuery } from './queries.ts';
import { itemAt } from './random.ts';

const SEED = 20261110;

const SIZES = [10_000, 100_000] as const;

const QUERY_COUNT = 200;

const WARMUP_QUERIES = 20;

const BUILD_RUNS = 3;

const P50 = 0.5;

const P95 = 0.95;

const ASYNC_RECORD_COUNT = 100_000;

const KEYS = ['title', 'body', 'tag'] as const;

const RESULTS_DIRECTORY = new URL('results/', import.meta.url);

const MEASURED_PACKAGES = [...ADAPTERS.map((adapter) => adapter.packageName), 'tinybench'];

interface BuildRun {
  readonly buildMs: number;
  readonly retainedHeapBytes: number;
  readonly retainedArrayBufferBytes: number;
}

interface SearchStats {
  readonly samples: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly meanMs: number;
  readonly maxMs: number;
  readonly queriesWithHits: number;
}

interface LibraryResult {
  readonly library: string;
  readonly size: number;
  readonly buildMs: number;
  readonly retainedHeapBytes: number;
  readonly retainedArrayBufferBytes: number;
  readonly buildRuns: readonly BuildRun[];
  readonly search: SearchStats;
}

type SliceGaps = Readonly<Record<SlicePhase, number>>;

function collectGarbage(): void {
  const { gc } = globalThis;
  if (gc === undefined) {
    throw new Error('run the benchmark with node --expose-gc');
  }
  gc();
}

function installedVersion(packageName: string): string {
  const manifest =
    packageName === 'typoseek'
      ? new URL('../package.json', import.meta.url)
      : new URL(`../node_modules/${packageName}/package.json`, import.meta.url);
  const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || !('version' in parsed) || typeof parsed.version !== 'string') {
    throw new TypeError(`${packageName} has no version in its package.json`);
  }
  return parsed.version;
}

function measureBuild(adapter: LibraryAdapter, records: readonly BenchRecord[]): { run: BuildRun; searcher: Searcher } {
  collectGarbage();
  const before = process.memoryUsage();
  const start = performance.now();
  const searcher = adapter.build(records);
  const buildMs = performance.now() - start;
  collectGarbage();
  const after = process.memoryUsage();
  return {
    run: {
      buildMs,
      retainedHeapBytes: after.heapUsed - before.heapUsed,
      retainedArrayBufferBytes: after.arrayBuffers - before.arrayBuffers,
    },
    searcher,
  };
}

async function measureSearch(name: string, searcher: Searcher, queries: readonly BenchQuery[]): Promise<SearchStats> {
  let next = 0;
  const lastHadHits = queries.map(() => false);
  const bench = new Bench({
    retainSamples: true,
    iterations: queries.length,
    time: 0,
    warmupIterations: WARMUP_QUERIES,
    warmupTime: 0,
    throws: true,
  });
  bench.add(name, () => {
    const position = next % queries.length;
    lastHadHits[position] = searcher.search(itemAt(queries, position).text) > 0;
    next += 1;
  });
  const [task] = await bench.run();
  const result = task?.result;
  if (result?.state !== 'completed' || result.latency.samples?.length !== queries.length) {
    throw new Error(`${name} did not complete one sample per query`);
  }
  const { samples, mean, max } = result.latency;
  return {
    samples: samples.length,
    p50Ms: nearestRank(samples, P50),
    p95Ms: nearestRank(samples, P95),
    meanMs: mean,
    maxMs: max,
    queriesWithHits: lastHadHits.filter(Boolean).length,
  };
}

async function measureLibrary(
  adapter: LibraryAdapter,
  records: readonly BenchRecord[],
  queries: readonly BenchQuery[],
): Promise<LibraryResult> {
  const discardedRuns = Array.from({ length: BUILD_RUNS - 1 }, () => measureBuild(adapter, records).run);
  const { run: keptRun, searcher } = measureBuild(adapter, records);
  const buildRuns = [...discardedRuns, keptRun];
  return {
    library: adapter.name,
    size: records.length,
    buildMs: median(buildRuns.map((run) => run.buildMs)),
    retainedHeapBytes: median(buildRuns.map((run) => run.retainedHeapBytes)),
    retainedArrayBufferBytes: median(buildRuns.map((run) => run.retainedArrayBufferBytes)),
    buildRuns,
    search: await measureSearch(`${adapter.name} ${String(records.length)}`, searcher, queries),
  };
}

async function longestSliceGaps(records: readonly BenchRecord[], abortAtSize?: number): Promise<SliceGaps> {
  const index = createIndex<BenchRecord>({ idKey: 'id', keys: [...KEYS] });
  const controller = new AbortController();
  const longest: Record<SlicePhase, number> = { preparation: 0, commit: 0, rollback: 0, idle: 0 };
  let committed = false;
  let lastTime = performance.now();
  let lastSize = index.size;
  const recordGap = (): void => {
    const now = performance.now();
    const size = index.size;
    const phase = slicePhase(lastSize, size, committed);
    committed ||= phase === 'commit';
    longest[phase] = Math.max(longest[phase], now - lastTime);
    if (abortAtSize !== undefined && size >= abortAtSize) {
      controller.abort();
    }
    lastTime = now;
    lastSize = size;
  };
  const probe = (): void => {
    recordGap();
    timer = setTimeout(probe, 0);
  };
  let timer = setTimeout(probe, 0);
  try {
    const outcome = await index.addAllAsync(records, { signal: controller.signal }).then(
      () => 'completed' as const,
      (error: unknown) => {
        if (isTyposeekError(error) && error.code === 'ABORTED') {
          return 'aborted' as const;
        }
        throw error;
      },
    );
    recordGap();
    const expected =
      abortAtSize === undefined ? { outcome: 'completed', size: records.length } : { outcome: 'aborted', size: 0 };
    if (outcome !== expected.outcome || index.size !== expected.size) {
      throw new Error(`addAllAsync ended ${outcome} with ${String(index.size)} records`);
    }
  } finally {
    clearTimeout(timer);
  }
  return longest;
}

function megabytes(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1);
}

function summary(results: readonly LibraryResult[]): string {
  const header = [
    '| Library | Records | p95 ms | p50 ms | Build ms | Retained heap MB | Retained array buffers MB | Queries with hits |',
    '|---|---|---|---|---|---|---|---|',
  ];
  const rows = results.map(
    (result) =>
      `| ${result.library} | ${String(result.size)} | ${result.search.p95Ms.toFixed(2)} | ${result.search.p50Ms.toFixed(2)} | ${result.buildMs.toFixed(0)} | ${megabytes(result.retainedHeapBytes)} | ${megabytes(result.retainedArrayBufferBytes)} | ${String(result.search.queriesWithHits)} |`,
  );
  return [...header, ...rows].join('\n');
}

async function main(): Promise<void> {
  const results: LibraryResult[] = [];
  for (const size of SIZES) {
    const dataset = generateDataset({ seed: SEED, size });
    const queries = generateQueries(dataset, { seed: SEED, count: QUERY_COUNT });
    for (const adapter of ADAPTERS) {
      const result = await measureLibrary(adapter, dataset.records, queries);
      results.push(result);
      console.log(`${adapter.name} ${String(size)}: p95 ${result.search.p95Ms.toFixed(2)} ms`);
    }
  }
  const { records } = generateDataset({ seed: SEED, size: ASYNC_RECORD_COUNT });
  const completed = await longestSliceGaps(records);
  const aborted = await longestSliceGaps(records, ASYNC_RECORD_COUNT / 2);
  const report = {
    measuredAt: new Date().toISOString(),
    command: 'npm run bench',
    machine: {
      cpu: cpus()[0]?.model ?? 'unknown',
      logicalCores: cpus().length,
      memoryBytes: totalmem(),
      os: `${type()} ${release()}`,
      osVersion: version(),
      arch: arch(),
      node: process.version,
    },
    packages: Object.fromEntries(MEASURED_PACKAGES.map((name) => [name, installedVersion(name)])),
    dataset: { seed: SEED, sizes: SIZES, queries: QUERY_COUNT, warmupQueries: WARMUP_QUERIES, buildRuns: BUILD_RUNS },
    percentiles: 'nearest rank over one sample per query',
    libraries: ADAPTERS.map(({ name, packageName, settings }) => ({ name, packageName, settings })),
    results,
    asyncSlices: {
      records: ASYNC_RECORD_COUNT,
      probe:
        'self-rescheduling setTimeout(0); a gap that grows the index is a commit slice, one that shrinks it a rollback slice, one before the first commit a preparation slice',
      longestPreparationGapMs: completed.preparation,
      longestCommitGapMs: completed.commit,
      longestRollbackGapMs: aborted.rollback,
      abortedAtRecords: ASYNC_RECORD_COUNT / 2,
    },
  };
  mkdirSync(RESULTS_DIRECTORY, { recursive: true });
  const file = new URL(`${report.measuredAt.replaceAll(':', '-')}.json`, RESULTS_DIRECTORY);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  console.log(summary(results));
  console.log(JSON.stringify(report.asyncSlices, null, 2));
  console.log(`written ${file.pathname}`);
}

await main();
