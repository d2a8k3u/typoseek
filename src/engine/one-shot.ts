import { TyposeekError } from '../core/errors';
import {
  resolveKeySpecs,
  resolveLimits,
  resolvePipelineOptions,
  resolveSearchOptions,
  SELF_FIELD,
} from '../core/options';
import { isArray } from '../core/paths';
import type {
  ArrayHit,
  KeySpec,
  Limits,
  ObjectSearchOptions,
  PipelineOptions,
  SearchOptions,
  SearchResponse,
  StringSearchOptions,
} from '../types';
import { createPipeline, prepareArrayItem } from './prepare';
import { checkedQuery, searchResponse } from './respond';
import { commitRecords, createBatch, createState, type StateConfig } from './state';

type OneShotOptions<T> = SearchOptions<T> &
  PipelineOptions & { readonly limits?: Partial<Limits>; readonly keys?: readonly KeySpec<T>[] };

const NO_OPTIONS = Object.freeze({});

function invalidOption(problem: string): TyposeekError {
  return new TyposeekError('INVALID_OPTION', problem);
}

function checkedItems(items: unknown): readonly unknown[] {
  if (!isArray(items)) {
    throw invalidOption('items must be an array');
  }
  return items;
}

function checkStringItemOptions(filter: unknown, sortBy: unknown): void {
  if (sortBy !== undefined) {
    throw invalidOption('sortBy needs keys, because string items have no key paths');
  }
  const filters = isArray(filter) ? filter : [filter];
  if (filter !== undefined && !filters.every((entry) => typeof entry === 'function')) {
    throw invalidOption('filter on string items must be a predicate or an array of predicates');
  }
}

/** @public */
export function search(
  items: readonly string[],
  query: string,
  options?: StringSearchOptions,
): SearchResponse<ArrayHit<string>>;
/** @public */
export function search<T extends object>(
  items: readonly T[],
  query: string,
  options: NoInfer<ObjectSearchOptions<T>>,
): SearchResponse<ArrayHit<T>>;
export function search<T>(
  items: readonly T[],
  query: string,
  options?: OneShotOptions<T>,
): SearchResponse<ArrayHit<T>> {
  const checked = checkedItems(items);
  const text = checkedQuery(query);
  const source: OneShotOptions<T> = options === undefined ? NO_OPTIONS : options;
  const { hooks, stopWords } = resolvePipelineOptions(source);
  const itemKind = source.keys === undefined ? 'string' : 'object';
  if (itemKind === 'string') {
    checkStringItemOptions(source.filter, source.sortBy);
  }
  const fields = source.keys === undefined ? [SELF_FIELD] : resolveKeySpecs(source.keys);
  const limits = resolveLimits(source.limits);
  const searchOptions = resolveSearchOptions(source);
  const pipeline = createPipeline(hooks, { kind: 'words', words: stopWords });
  const state = createState<T, StateConfig>({ fields, idKey: undefined, pipeline, limits });
  const batch = createBatch();
  const prepared = Array.from(checked, (item, position) => prepareArrayItem(state, item, position, itemKind, batch));
  commitRecords(state, prepared, 0, batch);
  return searchResponse(state, text, searchOptions, (doc, docNum, matches) => ({
    refIndex: docNum,
    item: doc.item,
    matches,
  }));
}
