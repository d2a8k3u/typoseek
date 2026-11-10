import { firstOsaRow, nextOsaRow, type OsaRow } from './distance';
import { BinaryHeap } from './heap';
import { codePointLength, compareCodePoints, compareTermRank, isCodePointBoundary, type RadixNode } from './radix-tree';

export type MatchKind = 'exact' | 'prefix' | 'infix' | 'fuzzy';

export const KIND_RANK = { exact: 0, prefix: 1, infix: 2, fuzzy: 3 } as const;

export const INFIX_GRAM_LENGTH = 3;

export const INFIX_SCAN_PER_EXPANSION = 20;

export interface ExpansionPolicy {
  readonly maxEdits: 0 | 1 | 2;
  readonly prefix: boolean;
  readonly infix: boolean;
  readonly maxExpansions: number;
}

export interface Expansion<V> {
  readonly term: string;
  readonly value: V;
  readonly kind: MatchKind;
  readonly distance: number;
  readonly firstCharTypo: boolean;
}

export interface ExpansionResult<V> {
  readonly expansions: readonly Expansion<V>[];
  readonly dpRows: number;
  readonly infixChecks: number;
}

export interface GramListView<V> {
  readonly size: number;
  readonly chunks: readonly (readonly V[])[];
}

export function typoCost(match: { readonly distance: number; readonly firstCharTypo: boolean }): number {
  return match.distance + (match.firstCharTypo ? 1 : 0);
}

export function compareExpansions<V>(a: Expansion<V>, b: Expansion<V>): number {
  return typoCost(a) - typoCost(b) || KIND_RANK[a.kind] - KIND_RANK[b.kind] || compareTermRank(a.term, b.term);
}

function gramsFrom(codePoints: readonly string[], firstOffset: number): readonly string[] {
  const grams = new Set<string>();
  for (let offset = firstOffset; offset + INFIX_GRAM_LENGTH <= codePoints.length; offset += 1) {
    grams.add(codePoints.slice(offset, offset + INFIX_GRAM_LENGTH).join(''));
  }
  return [...grams];
}

export function infixGrams(term: string): readonly string[] {
  return gramsFrom(Array.from(term), 1);
}

export function occursAfterFirstCodePoint(text: string, part: string): boolean {
  for (let found = text.indexOf(part, 1); found !== -1; found = text.indexOf(part, found + 1)) {
    if (isCodePointBoundary(text, found) && isCodePointBoundary(text, found + part.length)) {
      return true;
    }
  }
  return false;
}

interface Term {
  readonly term: string;
}

interface WalkedNode<V> {
  readonly node: RadixNode<V>;
  readonly pathText: string;
  readonly row: OsaRow;
  readonly closestPrefix: number;
}

interface Walk<V> {
  readonly reached: readonly WalkedNode<V>[];
  readonly stopped: readonly WalkedNode<V>[];
  readonly dpRows: number;
}

interface SelectionKey {
  readonly typoCost: number;
  readonly kindRank: number;
  readonly termLength: number;
  readonly text: string;
}

interface SelectableTerm<V> {
  readonly key: SelectionKey;
  readonly expansion: Expansion<V>;
  readonly advancesInfixCursor: boolean;
}

interface SelectableSubtree<V> {
  readonly key: SelectionKey;
  readonly subtree: RadixNode<V>;
  readonly pathText: string;
  readonly prefixDistance: number;
}

type Selectable<V> = SelectableTerm<V> | SelectableSubtree<V>;

function firstCodePointOf(text: string): string | undefined {
  const [first] = text;
  return first;
}

function walkEdge<V>(
  from: WalkedNode<V>,
  child: RadixNode<V>,
  queryCodePoints: readonly string[],
  maxEdits: number,
): WalkedNode<V> {
  let row = from.row;
  let closestPrefix = from.closestPrefix;
  for (const codePoint of child.edge) {
    row = nextOsaRow(queryCodePoints, row, codePoint);
    if (row.minimum > maxEdits) {
      break;
    }
    closestPrefix = Math.min(closestPrefix, row.last);
  }
  return { node: child, pathText: from.pathText + child.edge, row, closestPrefix };
}

function walkWithinEdits<V>(root: RadixNode<V>, queryCodePoints: readonly string[], maxEdits: number): Walk<V> {
  const reached: WalkedNode<V>[] = [];
  const stopped: WalkedNode<V>[] = [];
  const pending: WalkedNode<V>[] = [
    { node: root, pathText: '', row: firstOsaRow(queryCodePoints.length), closestPrefix: queryCodePoints.length },
  ];
  let dpRows = 0;
  for (let from = pending.pop(); from !== undefined; from = pending.pop()) {
    reached.push(from);
    for (const child of from.node.children) {
      const end = walkEdge(from, child, queryCodePoints, maxEdits);
      dpRows += end.row.sourceLength - from.row.sourceLength;
      (end.row.minimum <= maxEdits ? pending : stopped).push(end);
    }
  }
  return { reached, stopped, dpRows };
}

function hasFirstCharTypo(queryStart: string | undefined, text: string, distance: number): boolean {
  return distance > 0 && firstCodePointOf(text) !== queryStart;
}

function selectableSubtree<V>(
  queryStart: string | undefined,
  subtree: RadixNode<V>,
  pathText: string,
  prefixDistance: number,
): SelectableSubtree<V> {
  const firstCharTypo = hasFirstCharTypo(queryStart, pathText, prefixDistance);
  const key = {
    typoCost: typoCost({ distance: prefixDistance, firstCharTypo }),
    kindRank: KIND_RANK.prefix,
    termLength: subtree.minTermLength,
    text: pathText,
  };
  return { key, subtree, pathText, prefixDistance };
}

function openSubtree<V extends Term>(
  queryStart: string | undefined,
  { subtree, pathText, prefixDistance }: SelectableSubtree<V>,
): readonly Selectable<V>[] {
  const below = subtree.children.map((child) =>
    selectableSubtree(queryStart, child, pathText + child.edge, prefixDistance),
  );
  return subtree.value === undefined
    ? below
    : [selectableTerm(queryStart, subtree.value, 'prefix', prefixDistance), ...below];
}

function selectableTerm<V extends Term>(
  queryStart: string | undefined,
  value: V,
  kind: MatchKind,
  distance: number,
): SelectableTerm<V> {
  const firstCharTypo = hasFirstCharTypo(queryStart, value.term, distance);
  const expansion = { term: value.term, value, kind, distance, firstCharTypo };
  const key = {
    typoCost: typoCost(expansion),
    kindRank: KIND_RANK[kind],
    termLength: codePointLength(value.term),
    text: value.term,
  };
  return { key, expansion, advancesInfixCursor: false };
}

function walkMatch<V extends Term>(
  queryStart: string | undefined,
  walked: WalkedNode<V>,
  policy: ExpansionPolicy,
): readonly Selectable<V>[] {
  const { value } = walked.node;
  const wholeDistance = walked.row.last;
  if (value === undefined) {
    return [];
  }
  if (wholeDistance === 0) {
    return [selectableTerm(queryStart, value, 'exact', 0)];
  }
  if (policy.prefix && walked.closestPrefix <= policy.maxEdits) {
    return [selectableTerm(queryStart, value, 'prefix', walked.closestPrefix)];
  }
  return wholeDistance <= policy.maxEdits ? [selectableTerm(queryStart, value, 'fuzzy', wholeDistance)] : [];
}

function completionSubtrees<V>(
  queryStart: string | undefined,
  walk: Walk<V>,
  policy: ExpansionPolicy,
): readonly Selectable<V>[] {
  if (!policy.prefix) {
    return [];
  }
  return walk.stopped
    .filter((stop) => stop.closestPrefix <= policy.maxEdits)
    .map((stop) => selectableSubtree(queryStart, stop.node, stop.pathText, stop.closestPrefix));
}

function shortestQueryGramList<V>(
  grams: ReadonlyMap<string, GramListView<V>>,
  queryCodePoints: readonly string[],
): GramListView<V> | undefined {
  let shortest: GramListView<V> | undefined;
  for (const gram of gramsFrom(queryCodePoints, 0)) {
    const list = grams.get(gram);
    if (list === undefined) {
      return undefined;
    }
    if (shortest === undefined || list.size < shortest.size) {
      shortest = list;
    }
  }
  return shortest;
}

function* listedEntries<V>(list: GramListView<V> | undefined): Generator<V, undefined> {
  for (const chunk of list?.chunks ?? []) {
    yield* chunk;
  }
  return undefined;
}

function compareKeys(a: SelectionKey, b: SelectionKey): number {
  return (
    a.typoCost - b.typoCost ||
    a.kindRank - b.kindRank ||
    a.termLength - b.termLength ||
    compareCodePoints(a.text, b.text)
  );
}

export function expandTerm<V extends { readonly term: string }>(
  root: RadixNode<V>,
  grams: ReadonlyMap<string, GramListView<V>>,
  query: string,
  policy: ExpansionPolicy,
): ExpansionResult<V> {
  const queryCodePoints = Array.from(query);
  const [queryStart] = queryCodePoints;
  const walk = walkWithinEdits(root, queryCodePoints, policy.maxEdits);
  const listed = listedEntries(policy.infix ? shortestQueryGramList(grams, queryCodePoints) : undefined);
  const checkWindow = INFIX_SCAN_PER_EXPANSION * policy.maxExpansions;
  let infixChecks = 0;
  const nextInfixMatch = (): readonly Selectable<V>[] => {
    while (infixChecks < checkWindow) {
      const read = listed.next();
      if (read.done === true) {
        break;
      }
      infixChecks += 1;
      if (occursAfterFirstCodePoint(read.value.term, query)) {
        return [{ ...selectableTerm(queryStart, read.value, 'infix', 0), advancesInfixCursor: true }];
      }
    }
    return [];
  };
  const heap = new BinaryHeap<Selectable<V>>((a, b) => compareKeys(a.key, b.key));
  const pushAll = (entries: readonly Selectable<V>[]): void => {
    for (const entry of entries) {
      heap.push(entry);
    }
  };
  for (const walked of walk.reached) {
    pushAll(walkMatch(queryStart, walked, policy));
  }
  pushAll(completionSubtrees(queryStart, walk, policy));
  pushAll(nextInfixMatch());
  const expansions = new Map<string, Expansion<V>>();
  while (expansions.size < policy.maxExpansions) {
    const next = heap.pop();
    if (next === undefined) {
      break;
    }
    if (!('expansion' in next)) {
      pushAll(openSubtree(queryStart, next));
      continue;
    }
    if (!expansions.has(next.expansion.term)) {
      expansions.set(next.expansion.term, next.expansion);
    }
    if (next.advancesInfixCursor) {
      pushAll(nextInfixMatch());
    }
  }
  return { expansions: [...expansions.values()], dpRows: walk.dpRows, infixChecks };
}
