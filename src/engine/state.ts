import { invariantViolation } from '../core/errors';
import { infixGrams } from '../core/expand';
import type { ResolvedField } from '../core/options';
import { compareTermRank, RadixTree } from '../core/radix-tree';
import type { Id, Limits, Normalizer, Stemmer, Tokenizer } from '../types';

export interface Pipeline {
  readonly tokenize: Tokenizer;
  readonly normalize: Normalizer;
  readonly stem: Stemmer | undefined;
  readonly stopTerms: ReadonlySet<string>;
}

export interface StateConfig {
  readonly fields: readonly ResolvedField[];
  readonly idKey: string | undefined;
  readonly pipeline: Pipeline;
  readonly limits: Limits;
}

export interface TermEntry {
  readonly term: string;
  readonly postings: Map<number, number>;
  readonly surfaceIds: number[];
}

export interface SurfaceEntry {
  readonly id: number;
  readonly surface: string;
  readonly term: string | undefined;
  docCount: number;
}

export interface DocEntry<T> {
  readonly id: Id;
  readonly item: T;
  readonly stream: Int32Array;
}

export const GRAM_CHUNK_CAPACITY = 512;

export interface GramList {
  size: number;
  chunks: TermEntry[][];
}

export interface IndexState<T, C extends StateConfig = StateConfig> {
  readonly config: C;
  readonly terms: RadixTree<TermEntry>;
  readonly grams: Map<string, GramList>;
  readonly surfaces: Map<string, SurfaceEntry>;
  readonly surfacesById: Map<number, SurfaceEntry>;
  readonly docs: Map<number, DocEntry<T>>;
  readonly docNumById: Map<Id, number>;
  readonly lengthSums: number[];
  readonly freeSurfaceIds: number[];
  nextDocNum: number;
  nextSurfaceId: number;
}

export type KeyedState<T> = IndexState<T, StateConfig & { readonly idKey: string }>;

export interface NewSurface {
  readonly surface: string;
  readonly term: string | undefined;
}

export interface BatchContext {
  readonly ids: Set<Id>;
  readonly newSurfaceIndex: Map<string, number>;
  readonly newSurfaces: NewSurface[];
  readonly assignedIds: number[];
}

export interface PreparedRecord<T> {
  readonly id: Id;
  readonly item: T;
  readonly stream: Int32Array;
}

export const VALUE_BREAK = -1;

export const FIELD_BREAK = -2;

export const MAX_SURFACE_ID = 2_147_483_647;

const FIRST_BATCH_CODE = -3;

export function batchCode(position: number): number {
  return FIRST_BATCH_CODE - position;
}

function batchPosition(code: number): number {
  return FIRST_BATCH_CODE - code;
}

function visitTokenSlots(
  stream: Int32Array,
  fieldCount: number,
  visit: (slot: number, code: number, fieldIndex: number) => void,
): void {
  let fieldIndex = 0;
  for (const [slot, code] of stream.entries()) {
    if (slot < fieldCount || code === VALUE_BREAK) {
      continue;
    }
    if (code === FIELD_BREAK) {
      fieldIndex += 1;
    } else {
      visit(slot, code, fieldIndex);
    }
  }
}

export function newSurfaceAt(batch: BatchContext, position: number): NewSurface {
  const newSurface = batch.newSurfaces[position];
  if (newSurface === undefined) {
    throw invariantViolation('a stream references a new surface its batch does not hold');
  }
  return newSurface;
}

export function createState<T, C extends StateConfig>(config: C): IndexState<T, C> {
  return {
    config,
    terms: new RadixTree<TermEntry>(),
    grams: new Map(),
    surfaces: new Map(),
    surfacesById: new Map(),
    docs: new Map(),
    docNumById: new Map(),
    lengthSums: config.fields.map(() => 0),
    freeSurfaceIds: [],
    nextDocNum: 0,
    nextSurfaceId: 0,
  };
}

export function createBatch(): BatchContext {
  return { ids: new Set(), newSurfaceIndex: new Map(), newSurfaces: [], assignedIds: [] };
}

const HALF_CHUNK_CAPACITY = GRAM_CHUNK_CAPACITY / 2;

const MIN_MULTI_CHUNK_SIZE = GRAM_CHUNK_CAPACITY / 4;

function compareEntryRank(a: TermEntry, b: TermEntry): number {
  return compareTermRank(a.term, b.term);
}

function ranksBefore(a: TermEntry, b: TermEntry): boolean {
  return compareEntryRank(a, b) < 0;
}

function countBefore<E>(items: readonly E[], isBefore: (item: E) => boolean): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const item = items[middle];
    if (item !== undefined && isBefore(item)) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function mergeByRank(listed: readonly TermEntry[], added: readonly TermEntry[]): TermEntry[] {
  const merged: TermEntry[] = [];
  let addedIndex = 0;
  for (const entry of listed) {
    for (let next = added[addedIndex]; next !== undefined && ranksBefore(next, entry); next = added[addedIndex]) {
      merged.push(next);
      addedIndex += 1;
    }
    merged.push(entry);
  }
  return merged.concat(added.slice(addedIndex));
}

function cutEvenly(entries: readonly TermEntry[]): TermEntry[][] {
  const chunkCount = Math.ceil(entries.length / HALF_CHUNK_CAPACITY);
  const boundary = (chunkIndex: number): number => Math.floor((chunkIndex * entries.length) / chunkCount);
  return Array.from({ length: chunkCount }, (_, chunkIndex) =>
    entries.slice(boundary(chunkIndex), boundary(chunkIndex + 1)),
  );
}

function groupByGram(entries: readonly TermEntry[]): Map<string, TermEntry[]> {
  const groups = new Map<string, TermEntry[]>();
  for (const entry of entries) {
    for (const gram of infixGrams(entry.term)) {
      const group = groups.get(gram);
      if (group === undefined) {
        groups.set(gram, [entry]);
      } else {
        group.push(entry);
      }
    }
  }
  return groups;
}

interface ListPosition {
  readonly chunkIndex: number;
  readonly chunk: TermEntry[];
  readonly position: number;
}

function positionInList(list: GramList, entry: TermEntry): ListPosition {
  const lastRanksBefore = (chunk: readonly TermEntry[]): boolean => {
    const last = chunk.at(-1);
    return last !== undefined && ranksBefore(last, entry);
  };
  const chunkIndex = Math.min(countBefore(list.chunks, lastRanksBefore), list.chunks.length - 1);
  const chunk = list.chunks[chunkIndex];
  if (chunk === undefined) {
    throw invariantViolation('a gram list has no chunk');
  }
  return { chunkIndex, chunk, position: countBefore(chunk, (listed) => ranksBefore(listed, entry)) };
}

function halves(entries: TermEntry[]): TermEntry[][] {
  const middle = entries.length >>> 1;
  return [entries.slice(0, middle), entries.slice(middle)];
}

function insertIntoGramList(list: GramList, entry: TermEntry): void {
  const { chunkIndex, chunk, position } = positionInList(list, entry);
  chunk.splice(position, 0, entry);
  list.size += 1;
  if (chunk.length > GRAM_CHUNK_CAPACITY) {
    list.chunks.splice(chunkIndex, 1, ...halves(chunk));
  }
}

function addToGramLists(grams: Map<string, GramList>, created: readonly TermEntry[]): void {
  for (const [gram, group] of groupByGram(created)) {
    const list = grams.get(gram);
    if (list === undefined || group.length * GRAM_CHUNK_CAPACITY >= list.size) {
      const entries = mergeByRank(list?.chunks.flat() ?? [], group.sort(compareEntryRank));
      grams.set(gram, { size: entries.length, chunks: cutEvenly(entries) });
    } else {
      for (const entry of group) {
        insertIntoGramList(list, entry);
      }
    }
  }
}

function mergeWithAdjacentChunk(chunks: TermEntry[][], chunkIndex: number): void {
  const firstIndex = chunkIndex === chunks.length - 1 ? chunkIndex - 1 : chunkIndex;
  const merged = chunks.slice(firstIndex, firstIndex + 2).flat();
  chunks.splice(firstIndex, 2, ...(merged.length > GRAM_CHUNK_CAPACITY ? halves(merged) : [merged]));
}

function removeFromGramList(grams: Map<string, GramList>, gram: string, entry: TermEntry): void {
  const list = grams.get(gram);
  const located = list === undefined ? undefined : positionInList(list, entry);
  if (list === undefined || located?.chunk[located.position] !== entry) {
    throw invariantViolation('a pruned term is missing from its gram list');
  }
  located.chunk.splice(located.position, 1);
  list.size -= 1;
  if (list.size === 0) {
    grams.delete(gram);
  } else if (list.chunks.length > 1 && located.chunk.length < MIN_MULTI_CHUNK_SIZE) {
    mergeWithAdjacentChunk(list.chunks, located.chunkIndex);
  }
}

function removeFromGramLists(grams: Map<string, GramList>, deleted: readonly TermEntry[]): void {
  for (const entry of deleted) {
    for (const gram of infixGrams(entry.term)) {
      removeFromGramList(grams, gram, entry);
    }
  }
}

type TermEntryOf = (term: string) => TermEntry;

function committingTermEntries(terms: RadixTree<TermEntry>, created: TermEntry[]): TermEntryOf {
  const touched = new Map<string, TermEntry>();
  return (term) => {
    const touchedEntry = touched.get(term);
    if (touchedEntry !== undefined) {
      return touchedEntry;
    }
    let entry = terms.get(term);
    if (entry === undefined) {
      entry = { term, postings: new Map(), surfaceIds: [] };
      terms.set(term, entry);
      created.push(entry);
    }
    touched.set(term, entry);
    return entry;
  };
}

function knownSurface(state: IndexState<unknown>, surfaceId: number): SurfaceEntry {
  const surface = state.surfacesById.get(surfaceId);
  if (surface === undefined) {
    throw invariantViolation('a stream references an unknown surface id');
  }
  return surface;
}

function allocateSurfaceId(state: IndexState<unknown>): number {
  const reused = state.freeSurfaceIds.pop();
  if (reused !== undefined) {
    return reused;
  }
  const surfaceId = state.nextSurfaceId;
  if (surfaceId > MAX_SURFACE_ID) {
    throw invariantViolation(`a surface id allocation passes MAX_SURFACE_ID ${String(MAX_SURFACE_ID)}`);
  }
  state.nextSurfaceId += 1;
  return surfaceId;
}

function registerSurface(
  state: IndexState<unknown>,
  batch: BatchContext,
  position: number,
  termEntryOf: TermEntryOf,
): SurfaceEntry {
  const { surface, term } = newSurfaceAt(batch, position);
  const entry: SurfaceEntry = { id: allocateSurfaceId(state), surface, term, docCount: 0 };
  state.surfaces.set(surface, entry);
  state.surfacesById.set(entry.id, entry);
  if (term !== undefined) {
    termEntryOf(term).surfaceIds.push(entry.id);
  }
  batch.assignedIds[position] = entry.id;
  return entry;
}

function committedSurface(
  state: IndexState<unknown>,
  batch: BatchContext,
  code: number,
  termEntryOf: TermEntryOf,
): SurfaceEntry {
  if (code >= 0) {
    return knownSurface(state, code);
  }
  const position = batchPosition(code);
  const assignedId = batch.assignedIds[position];
  return assignedId === undefined
    ? registerSurface(state, batch, position, termEntryOf)
    : knownSurface(state, assignedId);
}

function addFieldLengths(lengthSums: number[], stream: Int32Array, sign: 1 | -1): void {
  for (const [fieldIndex, sum] of lengthSums.entries()) {
    lengthSums[fieldIndex] = sum + sign * (stream[fieldIndex] ?? 0);
  }
}

function commitRecord<T>(
  state: IndexState<T>,
  record: PreparedRecord<T>,
  docNum: number,
  batch: BatchContext,
  termEntryOf: TermEntryOf,
): void {
  const fieldCount = state.config.fields.length;
  const { stream } = record;
  const recordSurfaces = new Set<SurfaceEntry>();
  visitTokenSlots(stream, fieldCount, (slot, code, fieldIndex) => {
    const surface = committedSurface(state, batch, code, termEntryOf);
    stream[slot] = surface.id;
    recordSurfaces.add(surface);
    if (surface.term !== undefined) {
      const { postings } = termEntryOf(surface.term);
      const key = docNum * fieldCount + fieldIndex;
      postings.set(key, (postings.get(key) ?? 0) + 1);
    }
  });
  for (const surface of recordSurfaces) {
    surface.docCount += 1;
  }
  addFieldLengths(state.lengthSums, stream, 1);
  state.docs.set(docNum, { id: record.id, item: record.item, stream });
  state.docNumById.set(record.id, docNum);
}

export function commitRecords<T>(
  state: IndexState<T>,
  records: readonly PreparedRecord<T>[],
  firstDocNum: number,
  batch: BatchContext,
): void {
  const created: TermEntry[] = [];
  const termEntryOf = committingTermEntries(state.terms, created);
  for (const [offset, record] of records.entries()) {
    commitRecord(state, record, firstDocNum + offset, batch, termEntryOf);
  }
  state.nextDocNum = Math.max(state.nextDocNum, firstDocNum + records.length);
  addToGramLists(state.grams, created);
}

function existingTermEntry(terms: RadixTree<TermEntry>, term: string): TermEntry {
  const entry = terms.get(term);
  if (entry === undefined) {
    throw invariantViolation('a surface refers to a term the vocabulary does not hold');
  }
  return entry;
}

function removeSurfaceId(entry: TermEntry, surfaceId: number): void {
  const position = entry.surfaceIds.indexOf(surfaceId);
  if (position === -1) {
    throw invariantViolation('a pruned surface is missing from its term');
  }
  entry.surfaceIds.splice(position, 1);
}

export function retractRecord<T>(state: IndexState<T>, docNum: number): ReadonlySet<number> {
  const doc = state.docs.get(docNum);
  if (doc === undefined) {
    throw invariantViolation('a retracted docNum is not indexed');
  }
  const fieldCount = state.config.fields.length;
  const retracted = new Set<number>();
  visitTokenSlots(doc.stream, fieldCount, (_, surfaceId, fieldIndex) => {
    const { term } = knownSurface(state, surfaceId);
    retracted.add(surfaceId);
    if (term !== undefined) {
      existingTermEntry(state.terms, term).postings.delete(docNum * fieldCount + fieldIndex);
    }
  });
  for (const surfaceId of retracted) {
    knownSurface(state, surfaceId).docCount -= 1;
  }
  addFieldLengths(state.lengthSums, doc.stream, -1);
  return retracted;
}

export function pruneSurfaces<T>(state: IndexState<T>, surfaceIds: ReadonlySet<number>): void {
  const deleted: TermEntry[] = [];
  for (const surfaceId of surfaceIds) {
    const { surface, term, docCount } = knownSurface(state, surfaceId);
    if (docCount > 0) {
      continue;
    }
    state.surfaces.delete(surface);
    state.surfacesById.delete(surfaceId);
    state.freeSurfaceIds.push(surfaceId);
    if (term !== undefined) {
      const entry = existingTermEntry(state.terms, term);
      removeSurfaceId(entry, surfaceId);
      if (entry.surfaceIds.length === 0) {
        state.terms.delete(term);
        deleted.push(entry);
      }
    }
  }
  removeFromGramLists(state.grams, deleted);
}

export function averageFieldLength<T>(state: IndexState<T>, fieldIndex: number): number {
  const lengthSum = state.lengthSums[fieldIndex];
  if (lengthSum === undefined) {
    throw invariantViolation('a field index is outside the key paths');
  }
  return state.docs.size === 0 ? 0 : lengthSum / state.docs.size;
}
