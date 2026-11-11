import { integerBetween, itemAt, mulberry32, pick, type Random } from './random.ts';

export interface BenchRecord {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly tag: string;
}

export interface Dataset {
  readonly vocabulary: readonly string[];
  readonly records: readonly BenchRecord[];
}

export interface DatasetOptions {
  readonly seed: number;
  readonly size: number;
}

const VOCABULARY_SIZE = 50_000;

const MIN_WORD_LETTERS = 3;

const MAX_WORD_LETTERS = 12;

const DIACRITIC_WORD_SHARE = 0.1;

const TITLE_WORDS = { min: 3, max: 5 } as const;

const BODY_WORDS = { min: 5, max: 7 } as const;

const TAG_WORDS = { min: 1, max: 1 } as const;

const ZIPF_EXPONENT = 1;

const LETTERS: readonly string[] = Array.from('abcdefghijklmnopqrstuvwxyz');

const CZECH_DIACRITICS: ReadonlyMap<string, readonly string[]> = new Map([
  ['a', ['á']],
  ['c', ['č']],
  ['d', ['ď']],
  ['e', ['é', 'ě']],
  ['i', ['í']],
  ['n', ['ň']],
  ['o', ['ó']],
  ['r', ['ř']],
  ['s', ['š']],
  ['t', ['ť']],
  ['u', ['ú', 'ů']],
  ['y', ['ý']],
  ['z', ['ž']],
]);

function randomLetters(random: Random, length: number): string {
  return Array.from({ length }, () => pick(random, LETTERS)).join('');
}

function diacriticPositions(letters: readonly string[]): readonly number[] {
  return letters.flatMap((letter, position) => (CZECH_DIACRITICS.has(letter) ? [position] : []));
}

function withDiacritic(random: Random, word: string): string {
  const letters = Array.from(word);
  const position = pick(random, diacriticPositions(letters));
  letters[position] = pick(random, CZECH_DIACRITICS.get(itemAt(letters, position)) ?? []);
  return letters.join('');
}

function generateVocabulary(random: Random): readonly string[] {
  const taken = new Set<string>();
  const vocabulary: string[] = [];
  while (vocabulary.length < VOCABULARY_SIZE) {
    const length = integerBetween(random, MIN_WORD_LETTERS, MAX_WORD_LETTERS);
    const accented = random() < DIACRITIC_WORD_SHARE;
    let word = randomLetters(random, length);
    while (taken.has(word) || (accented && diacriticPositions(Array.from(word)).length === 0)) {
      word = randomLetters(random, length);
    }
    taken.add(word);
    vocabulary.push(accented ? withDiacritic(random, word) : word);
  }
  return vocabulary;
}

function zipfSampler(random: Random, vocabulary: readonly string[]): () => string {
  const cumulativeWeights = new Float64Array(vocabulary.length);
  let total = 0;
  for (let rank = 1; rank <= vocabulary.length; rank += 1) {
    total += 1 / rank ** ZIPF_EXPONENT;
    cumulativeWeights[rank - 1] = total;
  }
  return () => {
    const target = random() * total;
    let low = 0;
    let high = vocabulary.length - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (itemAt(cumulativeWeights, middle) > target) {
        high = middle;
      } else {
        low = middle + 1;
      }
    }
    return itemAt(vocabulary, low);
  };
}

function phrase(random: Random, nextWord: () => string, words: { readonly min: number; readonly max: number }): string {
  return Array.from({ length: integerBetween(random, words.min, words.max) }, nextWord).join(' ');
}

export function generateDataset(options: DatasetOptions): Dataset {
  const random = mulberry32(options.seed);
  const vocabulary = generateVocabulary(random);
  const nextWord = zipfSampler(random, vocabulary);
  const records = Array.from({ length: options.size }, (_, index): BenchRecord => ({
    id: String(index),
    title: phrase(random, nextWord, TITLE_WORDS),
    body: phrase(random, nextWord, BODY_WORDS),
    tag: phrase(random, nextWord, TAG_WORDS),
  }));
  return { vocabulary, records };
}
