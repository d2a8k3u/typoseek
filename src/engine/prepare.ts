import { TyposeekError, type ErrorCode } from '../core/errors';
import { foldTerm } from '../core/fold';
import type { PipelineHooks } from '../core/options';
import { isForbiddenPropertyName, isObjectRecord, resolveText } from '../core/paths';
import { tokenize, validateSpans } from '../core/tokenize';
import type { Id, Normalizer } from '../types';
import {
  batchCode,
  FIELD_BREAK,
  newSurfaceAt,
  VALUE_BREAK,
  type BatchContext,
  type IndexState,
  type KeyedState,
  type Pipeline,
  type PreparedRecord,
} from './state';

type StreamSource = Pick<IndexState<unknown>, 'config' | 'surfaces'>;

interface SurfaceSlot {
  readonly code: number;
  readonly term: string | undefined;
}

const ITEM_KIND_RULES = {
  string: 'items must all be strings',
  object: 'items must all be non-null, non-array objects',
} as const;

function recordRejection(code: ErrorCode, message: string, recordIndex: number | undefined): TyposeekError {
  return new TyposeekError(code, message, recordIndex === undefined ? undefined : { recordIndex });
}

function addNewSurface(pipeline: Pipeline, batch: BatchContext, surface: string): number {
  const position = batch.newSurfaces.length;
  batch.newSurfaces.push({ surface, term: processSurface(pipeline, surface) });
  batch.newSurfaceIndex.set(surface, position);
  return position;
}

function surfaceSlot(state: StreamSource, batch: BatchContext, surface: string): SurfaceSlot {
  const known = state.surfaces.get(surface);
  if (known !== undefined) {
    return { code: known.id, term: known.term };
  }
  const position = batch.newSurfaceIndex.get(surface) ?? addNewSurface(state.config.pipeline, batch, surface);
  return { code: batchCode(position), term: newSurfaceAt(batch, position).term };
}

function buildStream(state: StreamSource, item: unknown, batch: BatchContext): Int32Array {
  const { fields, pipeline } = state.config;
  const fieldLengths: number[] = [];
  const tokenSlots: number[] = [];
  for (const [fieldIndex, field] of fields.entries()) {
    if (fieldIndex > 0) {
      tokenSlots.push(FIELD_BREAK);
    }
    let fieldLength = 0;
    for (const [valueIndex, value] of resolveText(item, field.segments).entries()) {
      if (valueIndex > 0) {
        tokenSlots.push(VALUE_BREAK);
      }
      for (const span of validateSpans(pipeline.tokenize(value), value.length)) {
        const slot = surfaceSlot(state, batch, value.slice(span.start, span.end));
        tokenSlots.push(slot.code);
        fieldLength += slot.term === undefined ? 0 : 1;
      }
    }
    fieldLengths.push(fieldLength);
  }
  const stream = new Int32Array(fieldLengths.length + tokenSlots.length);
  stream.set(fieldLengths);
  stream.set(tokenSlots, fieldLengths.length);
  return stream;
}

function recordId(record: unknown, idKey: string, recordIndex: number | undefined): Id {
  if (!isObjectRecord(record)) {
    throw recordRejection('INVALID_RECORD', 'record must be a non-null, non-array object', recordIndex);
  }
  const id = Object.hasOwn(record, idKey) ? record[idKey] : undefined;
  if (!isValidId(id)) {
    throw recordRejection(
      'INVALID_ID',
      'the own property at idKey must be a non-empty string other than __proto__, constructor and prototype, or a finite number',
      recordIndex,
    );
  }
  return id;
}

export function prepareRecord<T>(
  state: KeyedState<T>,
  record: unknown,
  recordIndex: number | undefined,
  batch: BatchContext,
  mode: 'add' | 'update',
): PreparedRecord<T> {
  const id = recordId(record, state.config.idKey, recordIndex);
  const indexed = state.docNumById.has(id);
  if (mode === 'add' && (indexed || batch.ids.has(id))) {
    throw recordRejection(
      'DUPLICATE_ID',
      'add needs an id that is neither indexed nor earlier in the batch',
      recordIndex,
    );
  }
  if (mode === 'update' && !indexed) {
    throw recordRejection('UNKNOWN_ID', 'update needs an indexed id', recordIndex);
  }
  batch.ids.add(id);
  return { id, item: record as T, stream: buildStream(state, record, batch) };
}

function isItemOfKind(item: unknown, itemKind: 'string' | 'object'): boolean {
  return itemKind === 'string' ? typeof item === 'string' : isObjectRecord(item);
}

export function prepareArrayItem<T>(
  state: IndexState<T>,
  item: unknown,
  position: number,
  itemKind: 'string' | 'object',
  batch: BatchContext,
): PreparedRecord<T> {
  if (!isItemOfKind(item, itemKind)) {
    throw recordRejection('INVALID_RECORD', ITEM_KIND_RULES[itemKind], position);
  }
  return { id: position, item: item as T, stream: buildStream(state, item, batch) };
}

export type StopSource =
  | { readonly kind: 'words'; readonly words: readonly string[] }
  | { readonly kind: 'terms'; readonly terms: readonly string[] };

function checkedOutput(output: unknown, hook: 'normalize' | 'stem'): string {
  if (typeof output !== 'string') {
    throw new TyposeekError('INVALID_PIPELINE_OUTPUT', `${hook} must return a string`);
  }
  return output;
}

function normalizedStopTerms(normalize: Normalizer, words: readonly string[]): ReadonlySet<string> {
  const stopTerms = new Set<string>();
  for (const word of words) {
    const stopTerm = checkedOutput(normalize(word), 'normalize');
    if (stopTerm !== '') {
      stopTerms.add(stopTerm);
    }
  }
  return stopTerms;
}

export function createPipeline(hooks: PipelineHooks, stop: StopSource): Pipeline {
  const normalize = hooks.normalize ?? foldTerm;
  return Object.freeze({
    tokenize: hooks.tokenize ?? tokenize,
    normalize,
    stem: hooks.stem,
    stopTerms: stop.kind === 'terms' ? new Set(stop.terms) : normalizedStopTerms(normalize, stop.words),
  });
}

export function processSurface(pipeline: Pipeline, surface: string): string | undefined {
  const normalized = checkedOutput(pipeline.normalize(surface), 'normalize');
  if (normalized === '' || pipeline.stopTerms.has(normalized)) {
    return undefined;
  }
  if (pipeline.stem === undefined) {
    return normalized;
  }
  const stemmed = checkedOutput(pipeline.stem(normalized), 'stem');
  return stemmed === '' ? undefined : stemmed;
}

export function isValidId(value: unknown): value is Id {
  if (typeof value === 'string') {
    return value !== '' && !isForbiddenPropertyName(value);
  }
  return typeof value === 'number' && Number.isFinite(value);
}
