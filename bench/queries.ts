import type { BenchRecord, Dataset } from './dataset.ts';
import { integerBetween, itemAt, mulberry32, pick, type Random } from './random.ts';

export type QueryTermKind = 'unchanged' | 'oneEdit' | 'twoEdits' | 'prefix' | 'infix';

export interface QueryTerm {
  readonly kind: QueryTermKind;
  readonly source: string;
  readonly text: string;
}

export interface BenchQuery {
  readonly text: string;
  readonly terms: readonly QueryTerm[];
}

export interface QueryOptions {
  readonly seed: number;
  readonly count: number;
}

type KindWeights = readonly (readonly [kind: QueryTermKind, weight: number])[];

const LAST_TERM_KINDS: KindWeights = [
  ['unchanged', 40],
  ['oneEdit', 25],
  ['twoEdits', 20],
  ['prefix', 10],
  ['infix', 5],
];

const LAST_TERM_ONLY_KINDS: ReadonlySet<QueryTermKind> = new Set(['prefix', 'infix']);

const EARLIER_TERM_KINDS: KindWeights = LAST_TERM_KINDS.filter(([kind]) => !LAST_TERM_ONLY_KINDS.has(kind));

const MIN_SOURCE_LETTERS: Readonly<Record<QueryTermKind, number>> = {
  unchanged: 1,
  oneEdit: 1,
  twoEdits: 8,
  prefix: 3,
  infix: 4,
};

const TERMS_PER_QUERY = { min: 2, max: 3 } as const;

const MIN_PREFIX_LETTERS = 2;

const MIN_INFIX_LETTERS = 3;

const MIN_GAP_BETWEEN_SUBSTITUTIONS = 2;

const MAX_RECORD_DRAWS_PER_QUERY = 1_000;

const LETTERS: readonly string[] = Array.from('abcdefghijklmnopqrstuvwxyz');

type EditOperation = 'substitute' | 'insert' | 'delete' | 'transpose';

const EDIT_OPERATIONS: readonly EditOperation[] = ['substitute', 'insert', 'delete', 'transpose'];

function drawKind(random: Random, weights: KindWeights): QueryTermKind {
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
  let target = Math.floor(random() * total);
  for (const [kind, weight] of weights) {
    if (target < weight) {
      return kind;
    }
    target -= weight;
  }
  throw new RangeError('a kind draw fell outside the summed weights');
}

function recordWords(record: BenchRecord): readonly string[] {
  return [record.title, record.body, record.tag].join(' ').split(' ');
}

function sourcesFromRecord(
  random: Random,
  words: readonly string[],
  kinds: readonly QueryTermKind[],
): readonly string[] | undefined {
  const taken = new Set<number>();
  const sources: string[] = [];
  for (const kind of kinds) {
    const eligible = words.flatMap((word, position) =>
      !taken.has(position) && Array.from(word).length >= MIN_SOURCE_LETTERS[kind] ? [position] : [],
    );
    if (eligible.length === 0) {
      return undefined;
    }
    const position = pick(random, eligible);
    taken.add(position);
    sources.push(itemAt(words, position));
  }
  return sources;
}

function drawSources(
  random: Random,
  records: readonly BenchRecord[],
  kinds: readonly QueryTermKind[],
): readonly string[] {
  for (let draw = 0; draw < MAX_RECORD_DRAWS_PER_QUERY; draw += 1) {
    const sources = sourcesFromRecord(random, recordWords(pick(random, records)), kinds);
    if (sources !== undefined) {
      return sources;
    }
  }
  throw new RangeError(`no record of ${String(MAX_RECORD_DRAWS_PER_QUERY)} drawn holds words for ${kinds.join(', ')}`);
}

function otherLetter(random: Random, letter: string): string {
  let replacement = pick(random, LETTERS);
  while (replacement === letter) {
    replacement = pick(random, LETTERS);
  }
  return replacement;
}

function spliced(
  letters: readonly string[],
  start: number,
  deleteCount: number,
  inserted: readonly string[],
): readonly string[] {
  return [...letters.slice(0, start), ...inserted, ...letters.slice(start + deleteCount)];
}

function substitutedAt(random: Random, letters: readonly string[], position: number): readonly string[] {
  return spliced(letters, position, 1, [otherLetter(random, itemAt(letters, position))]);
}

function transposablePositions(letters: readonly string[]): readonly number[] {
  return letters.flatMap((letter, position) =>
    position + 1 < letters.length && letter !== letters[position + 1] ? [position] : [],
  );
}

function withOneEdit(random: Random, letters: readonly string[]): readonly string[] {
  const operation = pick(random, EDIT_OPERATIONS);
  const transposable = transposablePositions(letters);
  if (operation === 'insert') {
    return spliced(letters, integerBetween(random, 0, letters.length), 0, [pick(random, LETTERS)]);
  }
  if (operation === 'delete') {
    return spliced(letters, integerBetween(random, 0, letters.length - 1), 1, []);
  }
  if (operation === 'transpose' && transposable.length > 0) {
    const position = pick(random, transposable);
    return spliced(letters, position, 2, [itemAt(letters, position + 1), itemAt(letters, position)]);
  }
  return substitutedAt(random, letters, integerBetween(random, 0, letters.length - 1));
}

function withTwoSubstitutions(random: Random, letters: readonly string[]): readonly string[] {
  const first = integerBetween(random, 0, letters.length - 1);
  const apart = letters.flatMap((_, position) =>
    Math.abs(position - first) >= MIN_GAP_BETWEEN_SUBSTITUTIONS ? [position] : [],
  );
  return substitutedAt(random, substitutedAt(random, letters, first), pick(random, apart));
}

function truncated(random: Random, letters: readonly string[]): readonly string[] {
  return letters.slice(0, integerBetween(random, MIN_PREFIX_LETTERS, letters.length - 1));
}

function innerSubstring(random: Random, letters: readonly string[]): readonly string[] {
  const start = integerBetween(random, 1, letters.length - MIN_INFIX_LETTERS);
  return letters.slice(start, start + integerBetween(random, MIN_INFIX_LETTERS, letters.length - start));
}

const CHANGE_BY_KIND: Readonly<
  Record<QueryTermKind, (random: Random, letters: readonly string[]) => readonly string[]>
> = {
  unchanged: (_, letters) => letters,
  oneEdit: withOneEdit,
  twoEdits: withTwoSubstitutions,
  prefix: truncated,
  infix: innerSubstring,
};

function generateQuery(random: Random, records: readonly BenchRecord[]): BenchQuery {
  const termCount = integerBetween(random, TERMS_PER_QUERY.min, TERMS_PER_QUERY.max);
  const kinds = Array.from({ length: termCount }, (_, position) =>
    drawKind(random, position === termCount - 1 ? LAST_TERM_KINDS : EARLIER_TERM_KINDS),
  );
  const sources = drawSources(random, records, kinds);
  const terms = kinds.map((kind, position): QueryTerm => {
    const source = itemAt(sources, position);
    return { kind, source, text: CHANGE_BY_KIND[kind](random, Array.from(source)).join('') };
  });
  return { text: terms.map((term) => term.text).join(' '), terms };
}

export function generateQueries(dataset: Dataset, options: QueryOptions): readonly BenchQuery[] {
  const random = mulberry32(options.seed);
  return Array.from({ length: options.count }, () => generateQuery(random, dataset.records));
}
