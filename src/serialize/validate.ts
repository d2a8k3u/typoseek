import { TyposeekError } from '../core/errors';
import {
  checkKeySpecs,
  checkLimits,
  DEFAULT_LIMITS,
  isValidIdKey,
  type PipelineHooks,
  type ResolvedField,
} from '../core/options';
import { isArray, isObjectRecord, resolveText } from '../core/paths';
import { isIterableObject, validateSpans } from '../core/tokenize';
import { createPipeline, isValidId } from '../engine/prepare';
import {
  batchCode,
  batchPosition,
  createBatch,
  FIELD_BREAK,
  newSurfaceAt,
  VALUE_BREAK,
  valueRuns,
  type BatchContext,
  type Pipeline,
  type PreparedRecord,
  type ValueRun,
} from '../engine/state';
import type { Limits, LoadLimits, Tokenizer } from '../types';

export interface ValidatedSnapshot {
  readonly idKey: string;
  readonly fields: readonly ResolvedField[];
  readonly limits: Limits;
  readonly pipeline: Pipeline;
  readonly batch: BatchContext;
  readonly records: readonly PreparedRecord<object>[];
}

type SnapshotObject = Readonly<Record<string, unknown>>;

interface SnapshotRecord {
  readonly item: unknown;
  readonly stream: readonly unknown[];
}

interface SizedParts {
  readonly stopTerms: readonly unknown[];
  readonly surfaces: readonly unknown[];
  readonly records: readonly SnapshotRecord[];
}

interface SnapshotOptions {
  readonly idKey: string;
  readonly fields: readonly ResolvedField[];
  readonly limits: Limits;
}

interface FieldRuns {
  readonly field: ResolvedField;
  readonly runs: ValueRun<ResolvedField>[];
}

const LIMIT_KEYS: readonly string[] = Object.keys(DEFAULT_LIMITS);

const SNAPSHOT_FORMAT = 'typoseek-index';

const SNAPSHOT_VERSION = 1;

const RECORD_PAIR_LENGTH = 2;

const SURFACE_PAIR_LENGTH = 2;

function invalidSnapshot(problem: string, recordIndex?: number): TyposeekError {
  return new TyposeekError(
    'INVALID_SERIALIZED_INDEX',
    problem,
    recordIndex === undefined ? undefined : { recordIndex },
  );
}

function checkedSource(data: unknown): SnapshotObject {
  if (!isObjectRecord(data) || data.format !== SNAPSHOT_FORMAT) {
    throw invalidSnapshot(`data must be an object with format ${SNAPSHOT_FORMAT}`);
  }
  if (data.version !== SNAPSHOT_VERSION) {
    throw new TyposeekError('UNSUPPORTED_VERSION', `version must be ${String(SNAPSHOT_VERSION)}`);
  }
  return data;
}

function checkedArray(value: unknown, name: string, recordIndex?: number): readonly unknown[] {
  if (!isArray(value)) {
    throw invalidSnapshot(`${name} must be an array`, recordIndex);
  }
  return value;
}

function checkCount(count: number, limit: number, name: string, limitName: keyof LoadLimits): void {
  if (count > limit) {
    throw new TyposeekError('SERIALIZED_INDEX_TOO_LARGE', `${name} exceed loadLimits.${limitName} of ${String(limit)}`);
  }
}

function snapshotRecord(record: unknown, recordIndex: number): SnapshotRecord {
  if (!isArray(record) || record.length !== RECORD_PAIR_LENGTH) {
    throw invalidSnapshot('each record must be an [item, stream] pair', recordIndex);
  }
  const [item, stream] = record;
  return { item, stream: checkedArray(stream, 'each record stream', recordIndex) };
}

function sizedParts(source: SnapshotObject, loadLimits: LoadLimits): SizedParts {
  const records = checkedArray(source.records, 'records');
  const surfaces = checkedArray(source.surfaces, 'surfaces');
  const stopTerms = checkedArray(source.stopTerms, 'stopTerms');
  checkCount(records.length, loadLimits.maxRecords, 'records', 'maxRecords');
  checkCount(surfaces.length, loadLimits.maxSurfaces, 'surfaces', 'maxSurfaces');
  checkCount(stopTerms.length, loadLimits.maxStopTerms, 'stopTerms', 'maxStopTerms');
  const sized: SnapshotRecord[] = [];
  let tokens = 0;
  for (const [recordIndex, record] of records.entries()) {
    const checked = snapshotRecord(record, recordIndex);
    tokens += checked.stream.length;
    checkCount(tokens, loadLimits.maxTokens, 'stream slots', 'maxTokens');
    sized.push(checked);
  }
  return { stopTerms, surfaces, records: sized };
}

function hasExactlyLimitKeys(limits: SnapshotObject): boolean {
  return Reflect.ownKeys(limits).length === LIMIT_KEYS.length && LIMIT_KEYS.every((key) => Object.hasOwn(limits, key));
}

function snapshotOptions(source: SnapshotObject): SnapshotOptions {
  const { idKey, keys, limits } = source;
  if (!isValidIdKey(idKey)) {
    throw invalidSnapshot('idKey must be a non-empty string other than __proto__, constructor and prototype');
  }
  const keysCheck = checkKeySpecs(keys);
  if ('problem' in keysCheck) {
    throw invalidSnapshot(keysCheck.problem);
  }
  if (!isObjectRecord(limits) || !hasExactlyLimitKeys(limits)) {
    throw invalidSnapshot(`limits must be an object with exactly the keys ${LIMIT_KEYS.join(', ')}`);
  }
  const limitsCheck = checkLimits(limits);
  if ('problem' in limitsCheck) {
    throw invalidSnapshot(limitsCheck.problem);
  }
  return { idKey, fields: keysCheck.fields, limits: limitsCheck.limits };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function checkedStopTerms(stopTerms: readonly unknown[]): readonly string[] {
  const unique = new Set<string>();
  for (const stopTerm of stopTerms) {
    if (!isNonEmptyString(stopTerm) || unique.has(stopTerm)) {
      throw invalidSnapshot('stopTerms must be unique non-empty strings');
    }
    unique.add(stopTerm);
  }
  return [...unique];
}

function isSurfaceEntry(entry: unknown): entry is readonly [surface: string, term: string | null] {
  return (
    isArray(entry) &&
    entry.length === SURFACE_PAIR_LENGTH &&
    isNonEmptyString(entry[0]) &&
    (entry[1] === null || isNonEmptyString(entry[1]))
  );
}

function surfaceBatch(surfaces: readonly unknown[]): BatchContext {
  const batch = createBatch();
  for (const [position, entry] of surfaces.entries()) {
    if (!isSurfaceEntry(entry) || batch.newSurfaceIndex.has(entry[0])) {
      throw invalidSnapshot('surfaces must be unique pairs of a non-empty string and a non-empty string or null');
    }
    const [surface, term] = entry;
    batch.newSurfaces.push({ surface, term: term ?? undefined });
    batch.newSurfaceIndex.set(surface, position);
  }
  return batch;
}

function isSurfaceIndex(value: unknown, surfaceCount: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < surfaceCount;
}

function codedStream(slots: readonly unknown[], fieldCount: number, batch: BatchContext): Int32Array | undefined {
  if (slots.length < fieldCount) {
    return undefined;
  }
  const stream = new Int32Array(slots.length);
  let fieldIndex = 0;
  let fieldLength = 0;
  for (let position = fieldCount; position < slots.length; position += 1) {
    const slot = slots[position];
    if (slot === FIELD_BREAK) {
      stream[fieldIndex] = fieldLength;
      fieldIndex += 1;
      fieldLength = 0;
      if (fieldIndex === fieldCount) {
        return undefined;
      }
      stream[position] = FIELD_BREAK;
    } else if (slot === VALUE_BREAK) {
      stream[position] = VALUE_BREAK;
    } else if (isSurfaceIndex(slot, batch.newSurfaces.length)) {
      stream[position] = batchCode(slot);
      fieldLength += newSurfaceAt(batch, slot).term === undefined ? 0 : 1;
    } else {
      return undefined;
    }
  }
  stream[fieldIndex] = fieldLength;
  const headerMatches = slots.slice(0, fieldCount).every((fieldLength, index) => fieldLength === stream[index]);
  return fieldIndex === fieldCount - 1 && headerMatches ? stream : undefined;
}

function preparedRecord(
  { item, stream }: SnapshotRecord,
  recordIndex: number,
  { idKey, fields }: SnapshotOptions,
  batch: BatchContext,
): PreparedRecord<object> {
  if (!isObjectRecord(item)) {
    throw invalidSnapshot('each record item must be a non-null, non-array object', recordIndex);
  }
  const id = Object.hasOwn(item, idKey) ? item[idKey] : undefined;
  if (!isValidId(id) || batch.ids.has(id)) {
    throw invalidSnapshot(
      'the own property at idKey of each record must be a valid id no other record has',
      recordIndex,
    );
  }
  batch.ids.add(id);
  const coded = codedStream(stream, fields.length, batch);
  if (coded === undefined) {
    throw invalidSnapshot(
      `each record stream must hold ${String(fields.length)} field lengths, then surface indexes, VALUE_BREAK and ${String(fields.length - 1)} FIELD_BREAK`,
      recordIndex,
    );
  }
  return { id, item, stream: coded };
}

function* firstItems<E>(items: Iterable<E>, maxCount: number): Generator<E, undefined> {
  let count = 0;
  for (const item of items) {
    yield item;
    count += 1;
    if (count === maxCount) {
      return undefined;
    }
  }
  return undefined;
}

function boundedSpans(output: unknown, maxCount: number): unknown {
  return isIterableObject(output) ? firstItems(output, maxCount) : output;
}

function valueMatchesSlots(value: string, slots: Int32Array, tokenize: Tokenizer, batch: BatchContext): boolean {
  const spans = validateSpans(boundedSpans(tokenize(value), slots.length + 1), value.length);
  return (
    spans.length === slots.length &&
    slots.every((code, position) => {
      const span = spans[position];
      return (
        span !== undefined && newSurfaceAt(batch, batchPosition(code)).surface === value.slice(span.start, span.end)
      );
    })
  );
}

function fieldMatchesText(
  runs: readonly ValueRun<ResolvedField>[],
  values: readonly string[],
  tokenize: Tokenizer,
  batch: BatchContext,
): boolean {
  if (values.length === 0) {
    return runs.length === 1 && runs[0]?.slots.length === 0;
  }
  return (
    runs.length === values.length &&
    values.every((value, valueIndex) => {
      const run = runs[valueIndex];
      return run !== undefined && valueMatchesSlots(value, run.slots, tokenize, batch);
    })
  );
}

function runsByField(stream: Int32Array, fields: readonly ResolvedField[]): readonly FieldRuns[] {
  const grouped = fields.map((field): FieldRuns => ({ field, runs: [] }));
  for (const run of valueRuns(stream, fields)) {
    grouped[run.fieldIndex]?.runs.push(run);
  }
  return grouped;
}

function checkRecordText(
  { item, stream }: PreparedRecord<object>,
  recordIndex: number,
  fields: readonly ResolvedField[],
  tokenize: Tokenizer,
  batch: BatchContext,
): void {
  const matches = runsByField(stream, fields).every(({ field, runs }) =>
    fieldMatchesText(runs, resolveText(item, field.segments), tokenize, batch),
  );
  if (!matches) {
    throw invalidSnapshot('each record stream must match the tokens of its record text', recordIndex);
  }
}

function referencedSurfaceCount(records: readonly PreparedRecord<object>[], fieldCount: number): number {
  const referenced = new Set<number>();
  for (const { stream } of records) {
    for (const code of stream.subarray(fieldCount)) {
      if (code !== FIELD_BREAK && code !== VALUE_BREAK) {
        referenced.add(code);
      }
    }
  }
  return referenced.size;
}

export function validateSnapshot(data: unknown, loadLimits: LoadLimits, hooks: PipelineHooks): ValidatedSnapshot {
  const source = checkedSource(data);
  const parts = sizedParts(source, loadLimits);
  const options = snapshotOptions(source);
  const { idKey, fields, limits } = options;
  const pipeline = createPipeline(hooks, { kind: 'terms', terms: checkedStopTerms(parts.stopTerms) });
  const batch = surfaceBatch(parts.surfaces);
  const records = parts.records.map((record, recordIndex) => preparedRecord(record, recordIndex, options, batch));
  for (const [recordIndex, record] of records.entries()) {
    checkRecordText(record, recordIndex, fields, pipeline.tokenize, batch);
  }
  if (referencedSurfaceCount(records, fields.length) !== batch.newSurfaces.length) {
    throw invalidSnapshot('every surface must be referenced by a record stream');
  }
  return {
    idKey,
    fields,
    limits,
    pipeline,
    batch,
    records,
  };
}
