import { invariantViolation, TyposeekError } from '../core/errors';
import {
  resolveIdKey,
  resolveKeySpecs,
  resolveLimits,
  resolvePipelineOptions,
  resolveSearchOptions,
} from '../core/options';
import { isArray, isObjectRecord } from '../core/paths';
import type { Id, IndexOptions, SearchIndex, SearchOptions } from '../types';
import { createPipeline, isValidId, prepareRecord } from './prepare';
import { checkedQuery, searchResponse } from './respond';
import { toSnapshot } from './snapshot';
import {
  commitRecords,
  createBatch,
  createState,
  indexedDoc,
  pruneSurfaces,
  retractRecord,
  type BatchContext,
  type KeyedState,
  type PreparedRecord,
} from './state';

export const SLICE_BUDGET_MS = 10;

type AbortSource = Readonly<Record<string, unknown>> | undefined;

interface PreparedRun<T> {
  readonly batch: BatchContext;
  readonly prepared: readonly PreparedRecord<T>[];
  readonly sliceEnds: readonly number[];
}

function invalidOption(problem: string): TyposeekError {
  return new TyposeekError('INVALID_OPTION', problem);
}

function checkedRecords(records: unknown): readonly unknown[] {
  if (!isArray(records)) {
    throw invalidOption('records must be an array');
  }
  return records;
}

function abortSource(options: unknown): AbortSource {
  if (options === undefined) {
    return undefined;
  }
  if (!isObjectRecord(options)) {
    throw invalidOption('options must be an object');
  }
  const { signal } = options;
  if (signal === undefined || isObjectRecord(signal)) {
    return signal;
  }
  throw invalidOption('signal must be an object with an aborted property');
}

function abortError(signal: AbortSource): TyposeekError | undefined {
  return signal?.aborted === true
    ? new TyposeekError('ABORTED', 'addAllAsync was aborted', { cause: signal.reason })
    : undefined;
}

function throwIfAborted(signal: AbortSource): void {
  const error = abortError(signal);
  if (error !== undefined) {
    throw error;
  }
}

function removalDocNum(state: KeyedState<unknown>, id: unknown): number {
  if (!isValidId(id)) {
    throw new TyposeekError(
      'INVALID_ID',
      'id must be a non-empty string other than __proto__, constructor and prototype, or a finite number',
    );
  }
  const docNum = state.docNumById.get(id);
  if (docNum === undefined) {
    throw new TyposeekError('UNKNOWN_ID', 'remove needs an indexed id');
  }
  return docNum;
}

function indexedDocNum(state: KeyedState<unknown>, id: Id): number {
  const docNum = state.docNumById.get(id);
  if (docNum === undefined) {
    throw invariantViolation('a prepared update refers to an id that is not indexed');
  }
  return docNum;
}

function addRecords<T>(state: KeyedState<T>, records: readonly unknown[]): void {
  const batch = createBatch();
  const prepared = Array.from(records, (record, recordIndex) =>
    prepareRecord(state, record, recordIndex, batch, 'add'),
  );
  commitRecords(state, prepared, state.nextDocNum, batch);
}

function updateRecord<T>(state: KeyedState<T>, record: unknown): void {
  const batch = createBatch();
  const prepared = prepareRecord(state, record, undefined, batch, 'update');
  const docNum = indexedDocNum(state, prepared.id);
  const retracted = retractRecord(state, docNum);
  commitRecords(state, [prepared], docNum, batch);
  pruneSurfaces(state, retracted);
}

function withdrawDoc<T>(state: KeyedState<T>, docNum: number): ReadonlySet<number> {
  const { id } = indexedDoc(state, docNum);
  const retracted = retractRecord(state, docNum);
  state.docs.delete(docNum);
  state.docNumById.delete(id);
  return retracted;
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, 0);
  });
}

function runSlice(from: number, to: number, step: (position: number) => void): number {
  const sliceEnd = Date.now() + SLICE_BUDGET_MS;
  let position = from;
  do {
    step(position);
    position += 1;
  } while (position < to && Date.now() <= sliceEnd);
  return position;
}

async function prepareInSlices<T>(
  state: KeyedState<T>,
  records: readonly unknown[],
  signal: AbortSource,
): Promise<PreparedRun<T>> {
  const batch = createBatch();
  const prepared: PreparedRecord<T>[] = [];
  const sliceEnds: number[] = [];
  while (prepared.length < records.length) {
    const sliceEnd = runSlice(prepared.length, records.length, (recordIndex) => {
      prepared.push(prepareRecord(state, records[recordIndex], recordIndex, batch, 'add'));
    });
    sliceEnds.push(sliceEnd);
    await nextTurn();
    throwIfAborted(signal);
  }
  return { batch, prepared, sliceEnds };
}

async function rollBack<T>(state: KeyedState<T>, firstDocNum: number): Promise<void> {
  const endDocNum = state.nextDocNum;
  let next = firstDocNum;
  while (next < endDocNum) {
    const retracted = new Set<number>();
    next = runSlice(next, endDocNum, (docNum) => {
      for (const surfaceId of withdrawDoc(state, docNum)) {
        retracted.add(surfaceId);
      }
    });
    pruneSurfaces(state, retracted);
    if (next < endDocNum) {
      await nextTurn();
    }
  }
}

async function commitInSlices<T>(state: KeyedState<T>, run: PreparedRun<T>, signal: AbortSource): Promise<void> {
  const firstDocNum = state.nextDocNum;
  let sliceStart = 0;
  for (const sliceEnd of run.sliceEnds) {
    if (sliceStart > 0) {
      await nextTurn();
      const error = abortError(signal);
      if (error !== undefined) {
        await rollBack(state, firstDocNum);
        throw error;
      }
    }
    commitRecords(state, run.prepared.slice(sliceStart, sliceEnd), state.nextDocNum, run.batch);
    sliceStart = sliceEnd;
  }
}

async function addRecordsAsync<T>(
  state: KeyedState<T>,
  records: readonly unknown[],
  signal: AbortSource,
): Promise<void> {
  throwIfAborted(signal);
  const run = await prepareInSlices(state, records, signal);
  await commitInSlices(state, run, signal);
}

export function indexFromState<T>(state: KeyedState<T>): SearchIndex<T> {
  let busy = false;
  const assertIdle = (): void => {
    if (busy) {
      throw new TyposeekError('INDEX_BUSY', 'the index cannot change while addAllAsync runs');
    }
  };
  const addAll = (records: readonly T[]): void => {
    assertIdle();
    addRecords(state, checkedRecords(records));
  };
  return Object.freeze({
    get size() {
      return state.docs.size;
    },
    has: (id: Id) => state.docNumById.has(id),
    add: (record: T) => {
      addAll([record]);
    },
    addAll,
    addAllAsync: async (records: readonly T[], options?: unknown) => {
      assertIdle();
      const pending = Array.from(checkedRecords(records));
      const signal = abortSource(options);
      busy = true;
      try {
        await addRecordsAsync(state, pending, signal);
      } finally {
        busy = false;
      }
    },
    update: (record: T) => {
      assertIdle();
      updateRecord(state, record);
    },
    remove: (id: Id) => {
      assertIdle();
      pruneSurfaces(state, withdrawDoc(state, removalDocNum(state, id)));
    },
    search: (query: string, options?: SearchOptions<T>) =>
      searchResponse(state, checkedQuery(query), resolveSearchOptions(options), (doc, _, matches) => ({
        id: doc.id,
        item: doc.item,
        matches,
      })),
    toJSON: () => {
      assertIdle();
      return toSnapshot(state);
    },
  });
}

/** @public */
export function createIndex<T extends object>(options: IndexOptions<T>): SearchIndex<T> {
  const { hooks, stopWords } = resolvePipelineOptions(options);
  const idKey = resolveIdKey(options.idKey);
  const fields = resolveKeySpecs(options.keys);
  const limits = resolveLimits(options.limits);
  const pipeline = createPipeline(hooks, { kind: 'words', words: stopWords });
  return indexFromState<T>(createState({ fields, idKey, pipeline, limits }));
}
