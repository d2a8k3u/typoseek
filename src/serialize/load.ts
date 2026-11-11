import { resolveLoadOptions } from '../core/options';
import { indexFromState } from '../engine/create-index';
import { commitRecords, createState, type KeyedState, type PreparedRecord } from '../engine/state';
import type { LoadOptions, SearchIndex } from '../types';
import { validateSnapshot } from './validate';

const NO_LOAD_OPTIONS: LoadOptions = Object.freeze({});

/** @public */
export function loadIndex<T extends object>(data: unknown, options: LoadOptions = NO_LOAD_OPTIONS): SearchIndex<T> {
  const { hooks, loadLimits } = resolveLoadOptions(options);
  const { idKey, fields, pipeline, limits, batch, records } = validateSnapshot(data, loadLimits, hooks);
  const state: KeyedState<T> = createState({ idKey, fields, pipeline, limits });
  commitRecords(state, records as readonly PreparedRecord<T>[], 0, batch);
  return indexFromState(state);
}
