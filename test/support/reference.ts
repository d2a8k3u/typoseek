import { boundedOsaDistance, boundedPrefixDistance } from '../../src/core/distance.ts';
import {
  compareExpansions,
  INFIX_GRAM_LENGTH,
  INFIX_SCAN_PER_EXPANSION,
  type Expansion,
  type ExpansionPolicy,
  type GramListView,
  type MatchKind,
} from '../../src/core/expand.ts';
import { RadixTree } from '../../src/core/radix-tree.ts';

export interface VocabularyEntry {
  readonly term: string;
}

function codePointsOf(text: string): readonly number[] {
  return Array.from(text, (character) => character.codePointAt(0) ?? 0);
}

function referenceTermRank(a: string, b: string): number {
  const left = codePointsOf(a);
  const right = codePointsOf(b);
  const firstDifference = left.findIndex((codePoint, position) => codePoint !== right[position]);
  return (
    left.length - right.length ||
    (firstDifference === -1 ? 0 : (left[firstDifference] ?? 0) - (right[firstDifference] ?? 0))
  );
}

function gramsAfterOffset(term: string, firstOffset: number): readonly string[] {
  const characters = Array.from(term);
  const offsets = Array.from(
    { length: Math.max(0, characters.length - INFIX_GRAM_LENGTH - firstOffset + 1) },
    (_, position) => position + firstOffset,
  );
  return offsets.map((offset) => characters.slice(offset, offset + INFIX_GRAM_LENGTH).join(''));
}

function holdsAfterFirstCodePoint(term: string, part: string): boolean {
  const characters = Array.from(term);
  const wanted = Array.from(part);
  return characters.some(
    (_, offset) => offset >= 1 && wanted.every((character, position) => characters[offset + position] === character),
  );
}

function gramOwners(terms: readonly string[]): ReadonlyMap<string, readonly string[]> {
  const owners = new Map<string, string[]>();
  for (const term of [...new Set(terms)].sort(referenceTermRank)) {
    for (const gram of new Set(gramsAfterOffset(term, 1))) {
      owners.set(gram, [...(owners.get(gram) ?? []), term]);
    }
  }
  return owners;
}

export function vocabularyTree(terms: readonly string[]): RadixTree<VocabularyEntry> {
  const tree = new RadixTree<VocabularyEntry>();
  for (const term of terms) {
    tree.set(term, { term });
  }
  return tree;
}

function cutIntoChunks<V>(entries: readonly V[], chunkLengths: readonly number[]): readonly (readonly V[])[] {
  const chunks: V[][] = [];
  let start = 0;
  for (let chunk = 0; start < entries.length; chunk += 1) {
    const length = chunkLengths[chunk % chunkLengths.length] ?? entries.length;
    chunks.push(entries.slice(start, start + length));
    start += length;
  }
  return chunks;
}

export function gramLists(
  tree: RadixTree<VocabularyEntry>,
  terms: readonly string[],
  chunkLengths: readonly number[],
): ReadonlyMap<string, GramListView<VocabularyEntry>> {
  const lists = new Map<string, GramListView<VocabularyEntry>>();
  for (const [gram, owners] of gramOwners(terms)) {
    const entries = owners.map((term) => tree.get(term) ?? { term });
    lists.set(gram, { size: entries.length, chunks: cutIntoChunks(entries, chunkLengths) });
  }
  return lists;
}

function editMatrixDistance(source: readonly string[], target: readonly string[]): number {
  const known = new Map<number, number>();
  const width = target.length + 1;
  const distanceBetweenStarts = (sourceLength: number, targetLength: number): number => {
    if (sourceLength === 0 || targetLength === 0) {
      return sourceLength + targetLength;
    }
    const cell = sourceLength * width + targetLength;
    const sourceCharacter = source[sourceLength - 1];
    const targetCharacter = target[targetLength - 1];
    const endsInAdjacentSwap =
      sourceLength > 1 &&
      targetLength > 1 &&
      sourceCharacter === target[targetLength - 2] &&
      source[sourceLength - 2] === targetCharacter;
    const distance =
      known.get(cell) ??
      Math.min(
        distanceBetweenStarts(sourceLength - 1, targetLength) + 1,
        distanceBetweenStarts(sourceLength, targetLength - 1) + 1,
        distanceBetweenStarts(sourceLength - 1, targetLength - 1) + (sourceCharacter === targetCharacter ? 0 : 1),
        endsInAdjacentSwap ? distanceBetweenStarts(sourceLength - 2, targetLength - 2) + 1 : Number.POSITIVE_INFINITY,
      );
    known.set(cell, distance);
    return distance;
  };
  return distanceBetweenStarts(source.length, target.length);
}

function withinEdits(distance: number, maxEdits: number): number | undefined {
  return distance <= maxEdits ? distance : undefined;
}

export function editMatrixBoundedDistance(a: string, b: string, maxEdits: number): number | undefined {
  return withinEdits(editMatrixDistance(Array.from(a), Array.from(b)), maxEdits);
}

export function editMatrixBoundedPrefixDistance(
  query: string,
  candidate: string,
  maxEdits: number,
): number | undefined {
  const source = Array.from(query);
  const target = Array.from(candidate);
  const prefixDistances = Array.from({ length: target.length + 1 }, (_, prefixLength) =>
    editMatrixDistance(source, target.slice(0, prefixLength)),
  );
  return withinEdits(Math.min(...prefixDistances), maxEdits);
}

export type ReferenceMatch = Omit<Expansion<VocabularyEntry>, 'value'>;

function match(query: string, term: string, kind: MatchKind, distance: number): ReferenceMatch {
  const firstCharTypo = distance > 0 && Array.from(query)[0] !== Array.from(term)[0];
  return { term, kind, distance, firstCharTypo };
}

function typoMatch(query: string, term: string, policy: ExpansionPolicy): ReferenceMatch | undefined {
  const whole = boundedOsaDistance(query, term, policy.maxEdits);
  const closestPrefix = policy.prefix ? boundedPrefixDistance(query, term, policy.maxEdits) : undefined;
  if (whole === 0) {
    return match(query, term, 'exact', 0);
  }
  if (closestPrefix !== undefined) {
    return match(query, term, 'prefix', closestPrefix);
  }
  return whole === undefined ? undefined : match(query, term, 'fuzzy', whole);
}

function infixTerms(terms: readonly string[], query: string, policy: ExpansionPolicy): ReadonlySet<string> {
  const queryGrams = gramsAfterOffset(query, 0);
  if (!policy.infix || queryGrams.length === 0) {
    return new Set();
  }
  const owners = gramOwners(terms);
  const lists = queryGrams.map((gram) => owners.get(gram) ?? []);
  const fewestOwners = Math.min(...lists.map((list) => list.length));
  const scanned = lists.find((list) => list.length === fewestOwners) ?? [];
  const window = scanned.slice(0, INFIX_SCAN_PER_EXPANSION * policy.maxExpansions);
  return new Set(window.filter((term) => holdsAfterFirstCodePoint(term, query)));
}

function withValue(found: ReferenceMatch): Expansion<VocabularyEntry> {
  return { ...found, value: { term: found.term } };
}

function compareMatches(a: ReferenceMatch, b: ReferenceMatch): number {
  return compareExpansions(withValue(a), withValue(b));
}

export function referenceExpansion(
  terms: readonly string[],
  query: string,
  policy: ExpansionPolicy,
): readonly ReferenceMatch[] {
  const heldInside = infixTerms(terms, query, policy);
  const matches = [...new Set(terms)].flatMap((term) => {
    const candidates = [
      typoMatch(query, term, policy),
      heldInside.has(term) ? match(query, term, 'infix', 0) : undefined,
    ].filter((candidate) => candidate !== undefined);
    return candidates.sort(compareMatches).slice(0, 1);
  });
  return matches.sort(compareMatches).slice(0, policy.maxExpansions);
}
