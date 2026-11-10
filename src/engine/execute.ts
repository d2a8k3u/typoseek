import { boundedOsaDistance, boundedPrefixDistance } from '../core/distance';
import { invariantViolation } from '../core/errors';
import {
  expandTerm,
  KIND_RANK,
  occursAfterFirstCodePoint,
  typoCost,
  type Expansion,
  type MatchKind,
} from '../core/expand';
import { capQueryLength, capTerms, typoLimit, type ResolvedField, type ResolvedSearchOptions } from '../core/options';
import { parseQuery, type QueryClause } from '../core/query';
import { codePointLength, compareCodePoints } from '../core/radix-tree';
import { compareRelevance, idf, termContribution, weightedFieldFrequency, type RankKey } from '../core/rank';
import { validateSpans } from '../core/tokenize';
import { selectPage } from '../core/top-k';
import { processSurface } from './prepare';
import {
  averageFieldLength,
  indexedDoc,
  knownSurface,
  valueRuns,
  type IndexState,
  type Pipeline,
  type TermEntry,
} from './state';

export interface RankedRecord {
  readonly docNum: number;
  readonly matchedTerms: ReadonlySet<string>;
  readonly matchedSurfaceIds: ReadonlySet<number> | undefined;
}

export interface SearchPage {
  readonly total: number;
  readonly page: readonly RankedRecord[];
}

interface QueryToken {
  readonly clause: QueryClause;
  readonly surface: string;
}

interface ProcessedToken {
  readonly surface: string;
  readonly term: string | undefined;
  readonly isLast: boolean;
}

interface TermToken extends ProcessedToken {
  readonly term: string;
}

interface TermClause {
  readonly surface: string;
  readonly term: string;
  readonly exact: boolean;
  readonly isLast: boolean;
}

interface PhraseClause {
  readonly tokens: readonly ProcessedToken[];
}

interface QueryPlan {
  readonly positiveTerms: readonly TermClause[];
  readonly positivePhrases: readonly PhraseClause[];
  readonly negatedTerms: readonly TermClause[];
  readonly negatedPhrases: readonly PhraseClause[];
}

interface FieldScale {
  readonly weight: number;
  readonly averageLength: number;
}

interface SearchContext<T> {
  readonly state: IndexState<T>;
  readonly options: ResolvedSearchOptions<T>;
  readonly fields: readonly ResolvedField[];
  readonly scales: readonly FieldScale[];
}

interface MatchedTerm {
  readonly entry: TermEntry;
  readonly kept: ReadonlySet<number> | undefined;
}

interface TermMatch extends MatchedTerm {
  readonly expansion: Expansion<TermEntry>;
}

interface PhraseTerm extends MatchedTerm {
  readonly qualifying: ReadonlySet<number>;
}

type PhrasePosition = PhraseTerm | undefined;

interface ClauseHit {
  readonly typoCost: number;
  readonly kind: MatchKind;
  readonly contribution: number;
}

interface TermHit extends ClauseHit {
  readonly term: string;
}

interface MatchedClause {
  readonly hits: ReadonlyMap<number, ClauseHit>;
  readonly terms: readonly MatchedTerm[];
}

interface PositiveClause extends MatchedClause {
  readonly idf: number;
}

interface RecordMarks {
  readonly terms: ReadonlySet<string>;
  readonly surfaceIds: ReadonlySet<number> | undefined;
}

interface Marks {
  readonly termClauseTerms: readonly MatchedTerm[];
  readonly termClauseMarks: RecordMarks;
  readonly phrases: readonly MatchedClause[];
  readonly fold: boolean;
}

type SurfaceMatcher = (querySurface: string, surface: string, maxEdits: number) => boolean;

const SURFACE_MATCHES_UNDER_KIND: Readonly<Record<MatchKind, SurfaceMatcher>> = {
  exact: (querySurface, surface) => surface === querySurface,
  prefix: (querySurface, surface, maxEdits) => boundedPrefixDistance(querySurface, surface, maxEdits) !== undefined,
  infix: (querySurface, surface) => occursAfterFirstCodePoint(surface, querySurface),
  fuzzy: (querySurface, surface, maxEdits) => boundedOsaDistance(querySurface, surface, maxEdits) !== undefined,
};

const PHRASE_HIT_KIND: MatchKind = 'exact';

function composed(text: string): string {
  return text.normalize('NFC');
}

function tokenizeClauses(pipeline: Pipeline, clauses: readonly QueryClause[]): readonly QueryToken[] {
  return clauses.flatMap((clause) =>
    validateSpans(pipeline.tokenize(clause.text), clause.text.length).map((span) => ({
      clause,
      surface: clause.text.slice(span.start, span.end),
    })),
  );
}

function processTokensByClause(
  pipeline: Pipeline,
  tokens: readonly QueryToken[],
): ReadonlyMap<QueryClause, readonly ProcessedToken[]> {
  const lastToken = tokens.at(-1);
  const byClause = new Map<QueryClause, ProcessedToken[]>();
  for (const token of tokens) {
    const processed = {
      surface: token.surface,
      term: processSurface(pipeline, token.surface),
      isLast: token === lastToken,
    };
    const group = byClause.get(token.clause);
    if (group === undefined) {
      byClause.set(token.clause, [processed]);
    } else {
      group.push(processed);
    }
  }
  return byClause;
}

function isTermToken(token: ProcessedToken): token is TermToken {
  return token.term !== undefined;
}

function termClausesOf(clause: QueryClause, tokens: readonly TermToken[]): readonly TermClause[] {
  const exact = clause.negated || clause.kind === 'phrase';
  return tokens.map((token) => ({ surface: token.surface, term: token.term, exact, isLast: token.isLast && !exact }));
}

function mergeDuplicates(clauses: readonly TermClause[], fold: boolean): readonly TermClause[] {
  const merged = new Map<string, TermClause>();
  for (const clause of clauses) {
    const key = JSON.stringify([clause.exact, clause.term, fold ? '' : composed(clause.surface)]);
    const earlier = merged.get(key);
    merged.set(key, earlier === undefined ? clause : { ...earlier, isLast: earlier.isLast || clause.isLast });
  }
  return [...merged.values()];
}

function planQuery(byClause: ReadonlyMap<QueryClause, readonly ProcessedToken[]>, fold: boolean): QueryPlan {
  const positiveTerms: TermClause[] = [];
  const positivePhrases: PhraseClause[] = [];
  const negatedTerms: TermClause[] = [];
  const negatedPhrases: PhraseClause[] = [];
  for (const [clause, tokens] of byClause) {
    const termTokens = tokens.filter(isTermToken);
    if (clause.kind === 'phrase' && termTokens.length > 1) {
      (clause.negated ? negatedPhrases : positivePhrases).push({ tokens });
    } else {
      (clause.negated ? negatedTerms : positiveTerms).push(...termClausesOf(clause, termTokens));
    }
  }
  return { positiveTerms: mergeDuplicates(positiveTerms, fold), positivePhrases, negatedTerms, negatedPhrases };
}

function queryPlan<T>(state: IndexState<T>, query: string, options: ResolvedSearchOptions<T>): QueryPlan {
  const { pipeline, limits } = state.config;
  const { truncateQuery } = options;
  const clauses = parseQuery(capQueryLength(query, limits.maxQueryLength, truncateQuery));
  const tokens = capTerms(tokenizeClauses(pipeline, clauses), limits.maxQueryTerms, truncateQuery);
  return planQuery(processTokensByClause(pipeline, tokens), options.fold);
}

function searchContext<T>(state: IndexState<T>, options: ResolvedSearchOptions<T>): SearchContext<T> {
  const { fields } = state.config;
  const scales = fields.map((field, fieldIndex) => ({
    weight: field.weight,
    averageLength: averageFieldLength(state, fieldIndex),
  }));
  return { state, options, fields, scales };
}

function keptSurfaces<T>(
  state: IndexState<T>,
  entry: TermEntry,
  matches: (surface: string) => boolean,
): ReadonlySet<number> {
  return new Set(entry.surfaceIds.filter((surfaceId) => matches(composed(knownSurface(state, surfaceId).surface))));
}

function expandClause<T>(context: SearchContext<T>, clause: TermClause): readonly TermMatch[] {
  const { state, options } = context;
  const { typos } = options;
  const maxEdits = clause.exact || typos === false ? 0 : typoLimit(codePointLength(clause.term), typos);
  const { expansions } = expandTerm(state.terms.root, state.grams, clause.term, {
    maxEdits,
    prefix: clause.isLast && options.prefix,
    infix: clause.isLast && options.infix,
    maxExpansions: state.config.limits.maxExpansions,
  });
  if (options.fold) {
    return expansions.map((expansion) => ({ expansion, entry: expansion.value, kept: undefined }));
  }
  const querySurface = composed(clause.surface);
  return expansions.flatMap((expansion) => {
    const matchesUnderKind = SURFACE_MATCHES_UNDER_KIND[expansion.kind];
    const kept = keptSurfaces(state, expansion.value, (surface) => matchesUnderKind(querySurface, surface, maxEdits));
    return kept.size === 0 ? [] : [{ expansion, entry: expansion.value, kept }];
  });
}

function postedDocNums(entry: TermEntry, fieldCount: number): ReadonlySet<number> {
  const docNums = new Set<number>();
  for (const key of entry.postings.keys()) {
    docNums.add(Math.floor(key / fieldCount));
  }
  return docNums;
}

function docNumsHolding<T>(context: SearchContext<T>, matched: MatchedTerm): readonly number[] {
  const fieldCount = context.fields.length;
  const docNums = [...postedDocNums(matched.entry, fieldCount)];
  const { kept } = matched;
  if (kept === undefined) {
    return docNums;
  }
  return docNums.filter((docNum) =>
    indexedDoc(context.state, docNum)
      .stream.subarray(fieldCount)
      .some((surfaceId) => kept.has(surfaceId)),
  );
}

function fieldWeight<T>(context: SearchContext<T>, stream: Int32Array, fieldIndex: number, tf: number): number {
  const scale = context.scales[fieldIndex];
  const fieldLength = stream[fieldIndex];
  if (scale === undefined || fieldLength === undefined) {
    throw invariantViolation('a field index is outside the key paths');
  }
  return weightedFieldFrequency(tf, fieldLength, scale.averageLength, scale.weight);
}

function postedWeightedFrequency<T>(
  context: SearchContext<T>,
  docNum: number,
  stream: Int32Array,
  entry: TermEntry,
): number {
  let weighted = 0;
  for (const fieldIndex of context.fields.keys()) {
    const tf = entry.postings.get(docNum * context.fields.length + fieldIndex);
    if (tf !== undefined) {
      weighted += fieldWeight(context, stream, fieldIndex, tf);
    }
  }
  return weighted;
}

function keptWeightedFrequency<T>(context: SearchContext<T>, stream: Int32Array, kept: ReadonlySet<number>): number {
  let weighted = 0;
  for (const { fieldIndex, slots } of valueRuns(stream, context.fields)) {
    const tf = slots.filter((surfaceId) => kept.has(surfaceId)).length;
    if (tf > 0) {
      weighted += fieldWeight(context, stream, fieldIndex, tf);
    }
  }
  return weighted;
}

function weightedFrequency<T>(context: SearchContext<T>, docNum: number, matched: MatchedTerm): number {
  const { stream } = indexedDoc(context.state, docNum);
  return matched.kept === undefined
    ? postedWeightedFrequency(context, docNum, stream, matched.entry)
    : keptWeightedFrequency(context, stream, matched.kept);
}

function compareTermHits(a: TermHit, b: TermHit): number {
  return (
    a.typoCost - b.typoCost ||
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    b.contribution - a.contribution ||
    compareCodePoints(a.term, b.term)
  );
}

function termClauseMatch<T>(context: SearchContext<T>, clause: TermClause): MatchedClause {
  const matches = expandClause(context, clause);
  const hits = new Map<number, TermHit>();
  for (const match of matches) {
    for (const docNum of docNumsHolding(context, match)) {
      const hit = {
        typoCost: typoCost(match.expansion),
        kind: match.expansion.kind,
        contribution: termContribution(weightedFrequency(context, docNum, match)),
        term: match.expansion.term,
      };
      const best = hits.get(docNum);
      if (best === undefined || compareTermHits(hit, best) < 0) {
        hits.set(docNum, hit);
      }
    }
  }
  return { hits, terms: matches };
}

function negatedTermDocNums<T>(context: SearchContext<T>, clause: TermClause): readonly number[] {
  return expandClause(context, clause).flatMap((match) => docNumsHolding(context, match));
}

function phrasePositions<T>(context: SearchContext<T>, phrase: PhraseClause): readonly PhrasePosition[] | undefined {
  const positions: PhrasePosition[] = [];
  for (const token of phrase.tokens) {
    if (!isTermToken(token)) {
      positions.push(undefined);
      continue;
    }
    const [match] = expandClause(context, { surface: token.surface, term: token.term, exact: true, isLast: false });
    if (match === undefined) {
      return undefined;
    }
    positions.push({ entry: match.entry, kept: match.kept, qualifying: match.kept ?? new Set(match.entry.surfaceIds) });
  }
  return positions;
}

function hasPosting(entry: TermEntry, docNum: number, fieldCount: number): boolean {
  for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex += 1) {
    if (entry.postings.has(docNum * fieldCount + fieldIndex)) {
      return true;
    }
  }
  return false;
}

function qualifies(position: PhrasePosition, surfaceId: number): boolean {
  return position === undefined || position.qualifying.has(surfaceId);
}

function holdsSequence(
  stream: Int32Array,
  fields: readonly ResolvedField[],
  positions: readonly PhrasePosition[],
): boolean {
  for (const { slots } of valueRuns(stream, fields)) {
    for (let start = 0; start + positions.length <= slots.length; start += 1) {
      const window = slots.subarray(start, start + positions.length);
      if (window.every((surfaceId, offset) => qualifies(positions[offset], surfaceId))) {
        return true;
      }
    }
  }
  return false;
}

function isPhraseTerm(position: PhrasePosition): position is PhraseTerm {
  return position !== undefined;
}

function phraseDocNums<T>(context: SearchContext<T>, positions: readonly PhrasePosition[]): readonly number[] {
  const { state, fields } = context;
  const terms = positions.filter(isPhraseTerm);
  const rarest = terms.reduce((rarer, term) => (term.entry.postings.size < rarer.entry.postings.size ? term : rarer));
  return [...postedDocNums(rarest.entry, fields.length)].filter(
    (docNum) =>
      terms.every((term) => hasPosting(term.entry, docNum, fields.length)) &&
      holdsSequence(indexedDoc(state, docNum).stream, fields, positions),
  );
}

function phraseMatch<T>(context: SearchContext<T>, phrase: PhraseClause): MatchedClause {
  const positions = phrasePositions(context, phrase);
  if (positions === undefined) {
    return { hits: new Map(), terms: [] };
  }
  const terms = positions.filter(isPhraseTerm);
  const hits = new Map<number, ClauseHit>();
  for (const docNum of phraseDocNums(context, positions)) {
    const contribution = terms.reduce(
      (sum, term) => sum + termContribution(weightedFrequency(context, docNum, term)),
      0,
    );
    hits.set(docNum, { typoCost: 0, kind: PHRASE_HIT_KIND, contribution });
  }
  return { hits, terms };
}

function negatedPhraseDocNums<T>(context: SearchContext<T>, phrase: PhraseClause): readonly number[] {
  const positions = phrasePositions(context, phrase);
  return positions === undefined ? [] : phraseDocNums(context, positions);
}

function excludedDocNums<T>(context: SearchContext<T>, plan: QueryPlan): ReadonlySet<number> {
  return new Set([
    ...plan.negatedTerms.flatMap((clause) => negatedTermDocNums(context, clause)),
    ...plan.negatedPhrases.flatMap((phrase) => negatedPhraseDocNums(context, phrase)),
  ]);
}

function withIdf<T>(context: SearchContext<T>, clauses: readonly MatchedClause[]): readonly PositiveClause[] {
  const recordCount = context.state.docs.size;
  return clauses.map((clause) => ({ ...clause, idf: idf(recordCount, clause.hits.size) }));
}

function combine(positives: readonly PositiveClause[], mode: 'and' | 'or'): readonly number[] {
  if (mode === 'or') {
    return [...new Set(positives.flatMap(({ hits }) => [...hits.keys()]))];
  }
  const rarest = positives.reduce((rarer, clause) => (clause.hits.size < rarer.hits.size ? clause : rarer));
  return [...rarest.hits.keys()].filter((docNum) => positives.every(({ hits }) => hits.has(docNum)));
}

function rankKey(docNum: number, positives: readonly PositiveClause[]): RankKey {
  let matchedClauses = 0;
  let totalTypoCost = 0;
  let infixMatches = 0;
  let prefixMatches = 0;
  let score = 0;
  for (const clause of positives) {
    const hit = clause.hits.get(docNum);
    if (hit !== undefined) {
      matchedClauses += 1;
      totalTypoCost += hit.typoCost;
      infixMatches += Number(hit.kind === 'infix');
      prefixMatches += Number(hit.kind === 'prefix');
      score += clause.idf * hit.contribution;
    }
  }
  return { matchedClauses, typoCost: totalTypoCost, infixMatches, prefixMatches, score, docNum };
}

function recordMarks(terms: readonly MatchedTerm[], fold: boolean): RecordMarks {
  const keptSurfaceIds = new Set(terms.flatMap(({ kept }) => [...(kept ?? [])]));
  return { terms: new Set(terms.map(({ entry }) => entry.term)), surfaceIds: fold ? undefined : keptSurfaceIds };
}

function rankedRecord(docNum: number, marks: Marks): RankedRecord {
  const phraseTerms = marks.phrases.filter(({ hits }) => hits.has(docNum)).flatMap(({ terms }) => terms);
  const { terms, surfaceIds } =
    phraseTerms.length === 0
      ? marks.termClauseMarks
      : recordMarks([...marks.termClauseTerms, ...phraseTerms], marks.fold);
  return { docNum, matchedTerms: terms, matchedSurfaceIds: surfaceIds };
}

function docNumsInOrder<T>(state: IndexState<T>, offset: number, limit: number): readonly number[] {
  const page: number[] = [];
  let position = 0;
  for (const docNum of state.docs.keys()) {
    if (position >= offset + limit) {
      break;
    }
    if (position >= offset) {
      page.push(docNum);
    }
    position += 1;
  }
  return page;
}

interface DocNumPage {
  readonly total: number;
  readonly page: readonly number[];
}

function docNumPage(selected: {
  readonly total: number;
  readonly page: readonly { readonly docNum: number }[];
}): DocNumPage {
  return { total: selected.total, page: selected.page.map((entry) => entry.docNum) };
}

function orderedPage<T>(
  context: SearchContext<T>,
  candidates: readonly number[],
  positives: readonly PositiveClause[],
): DocNumPage {
  const { offset, limit, sortBy } = context.options;
  if (sortBy === undefined) {
    const keys = candidates.map((docNum) => rankKey(docNum, positives));
    return docNumPage(selectPage(keys, compareRelevance, offset, limit));
  }
  const keyed = candidates.map((docNum) => ({ docNum, sortKey: sortBy.keyOf(indexedDoc(context.state, docNum).item) }));
  const compareSorted = (a: (typeof keyed)[number], b: (typeof keyed)[number]): number =>
    sortBy.compare(a.sortKey, b.sortKey) || a.docNum - b.docNum;
  return docNumPage(selectPage(keyed, compareSorted, offset, limit));
}

function isListedInOrder<T>(
  positives: readonly PositiveClause[],
  excluded: ReadonlySet<number>,
  options: ResolvedSearchOptions<T>,
): boolean {
  return positives.length === 0 && excluded.size === 0 && options.filter === undefined && options.sortBy === undefined;
}

export function executeSearch<T>(state: IndexState<T>, query: string, options: ResolvedSearchOptions<T>): SearchPage {
  const plan = queryPlan(state, query, options);
  const context = searchContext(state, options);
  const termMatches = plan.positiveTerms.map((clause) => termClauseMatch(context, clause));
  const phraseMatches = plan.positivePhrases.map((phrase) => phraseMatch(context, phrase));
  const positives = withIdf(context, [...termMatches, ...phraseMatches]);
  const termClauseTerms = termMatches.flatMap(({ terms }) => terms);
  const marks: Marks = {
    termClauseTerms,
    termClauseMarks: recordMarks(termClauseTerms, options.fold),
    phrases: phraseMatches,
    fold: options.fold,
  };
  const excluded = excludedDocNums(context, plan);
  const toRanked = (docNum: number): RankedRecord => rankedRecord(docNum, marks);
  if (isListedInOrder(positives, excluded, options)) {
    return { total: state.docs.size, page: docNumsInOrder(state, options.offset, options.limit).map(toRanked) };
  }
  const { filter } = options;
  const candidates = (positives.length === 0 ? [...state.docs.keys()] : combine(positives, options.mode)).filter(
    (docNum) => !excluded.has(docNum) && (filter === undefined || filter(indexedDoc(state, docNum).item)),
  );
  const { total, page } = orderedPage(context, candidates, positives);
  return { total, page: page.map(toRanked) };
}
