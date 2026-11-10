import {
  resolveKeySpecs,
  resolveLimits,
  resolvePipelineOptions,
  resolveSearchOptions,
} from '../../src/core/options.ts';
import { executeSearch } from '../../src/engine/execute.ts';
import { highlightRecord } from '../../src/engine/highlight.ts';
import { createPipeline, prepareRecord } from '../../src/engine/prepare.ts';
import { commitRecords, createBatch, createState, type KeyedState } from '../../src/engine/state.ts';
import type { IndexHit, Limits, PipelineOptions, SearchOptions, SearchResponse } from '../../src/types.ts';

export interface EngineOptions extends PipelineOptions {
  readonly keys: readonly (string | { readonly path: string; readonly weight: number })[];
  readonly limits?: Partial<Limits>;
}

export function buildState<T>(records: readonly T[], options: EngineOptions): KeyedState<T> {
  const { hooks, stopWords } = resolvePipelineOptions(options);
  const state: KeyedState<T> = createState({
    fields: resolveKeySpecs(options.keys),
    idKey: 'id',
    pipeline: createPipeline(hooks, { kind: 'words', words: stopWords }),
    limits: resolveLimits(options.limits),
  });
  const batch = createBatch();
  const prepared = records.map((record, index) => prepareRecord(state, record, index, batch, 'add'));
  commitRecords(state, prepared, 0, batch);
  return state;
}

export function searchState<T>(
  state: KeyedState<T>,
  query: string,
  options: SearchOptions<T> = {},
): SearchResponse<IndexHit<T>> {
  const { total, page } = executeSearch(state, query, resolveSearchOptions(options));
  const hits = page.map((ranked) => {
    const doc = state.docs.get(ranked.docNum);
    if (doc === undefined) {
      throw new Error('test harness: a ranked docNum is not indexed');
    }
    return { id: doc.id, item: doc.item, matches: highlightRecord(state, ranked) };
  });
  return { total, hits };
}

export function searchRecords<T>(
  records: readonly T[],
  engineOptions: EngineOptions,
  query: string,
  searchOptions: SearchOptions<T> = {},
): SearchResponse<IndexHit<T>> {
  return searchState(buildState(records, engineOptions), query, searchOptions);
}

export function hitIds(response: SearchResponse<IndexHit<unknown>>): readonly unknown[] {
  return response.hits.map((hit) => hit.id);
}
