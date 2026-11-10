import { describe, expect, test } from 'vitest';
import {
  compareExpansions,
  expandTerm,
  infixGrams,
  occursAfterFirstCodePoint,
  typoCost,
  type Expansion,
  type ExpansionPolicy,
  type MatchKind,
} from '../../../src/core/expand.ts';
import { gramLists, vocabularyTree } from '../../support/reference.ts';

interface Entry {
  readonly term: string;
}

function expansion(term: string, kind: MatchKind, distance: number, firstCharTypo = false): Expansion<Entry> {
  return { term, value: { term }, kind, distance, firstCharTypo };
}

const SINGLE_CHUNK = [512];

const EXACT_ONLY: ExpansionPolicy = { maxEdits: 0, prefix: false, infix: false, maxExpansions: 50 };

function expand(
  terms: readonly string[],
  query: string,
  policy: Partial<ExpansionPolicy>,
  chunkLengths: readonly number[] = SINGLE_CHUNK,
): { readonly matches: readonly string[]; readonly dpRows: number; readonly infixChecks: number } {
  const tree = vocabularyTree(terms);
  const { expansions, dpRows, infixChecks } = expandTerm(tree.root, gramLists(tree, terms, chunkLengths), query, {
    ...EXACT_ONLY,
    ...policy,
  });
  const matches = expansions.map(
    ({ term, kind, distance, firstCharTypo }) =>
      `${term} ${kind} ${String(distance)}${firstCharTypo ? ' first-letter' : ''}`,
  );
  return { matches, dpRows, infixChecks };
}

describe('expandTerm within the edit limit', () => {
  const VOCABULARY = ['seek', 'seem', 'peek', 'sleek', 'sek', 'esek', 'seeking', 'speak'];

  test.each<[0 | 1 | 2, readonly string[]]>([
    [0, ['seek exact 0']],
    [
      1,
      [
        'seek exact 0',
        'sek fuzzy 1',
        'seem fuzzy 1',
        'sleek fuzzy 1',
        'esek fuzzy 1 first-letter',
        'peek fuzzy 1 first-letter',
      ],
    ],
    [
      2,
      [
        'seek exact 0',
        'sek fuzzy 1',
        'seem fuzzy 1',
        'sleek fuzzy 1',
        'esek fuzzy 1 first-letter',
        'peek fuzzy 1 first-letter',
        'speak fuzzy 2',
      ],
    ],
  ])('returns every term within %i edits of the query and none beyond', (maxEdits, matches) => {
    expect(expand(VOCABULARY, 'seek', { maxEdits }).matches).toEqual(matches);
  });

  test('continues below the first node within the limit and skips a term it passes beyond the limit', () => {
    expect(expand(['ab', 'abc', 'abcd'], 'abcd', { maxEdits: 1 }).matches).toEqual(['abcd exact 0', 'abc fuzzy 1']);
  });

  test('returns the value the tree holds for the term', () => {
    const tree = vocabularyTree(['seek']);

    const { expansions } = expandTerm(tree.root, new Map(), 'seek', EXACT_ONLY);

    expect(expansions.map(({ value }) => value)).toEqual([tree.get('seek')]);
    expect(expansions[0]?.value).toBe(tree.get('seek'));
  });

  test('counts one row per code point it walks and stops below a row beyond the limit', () => {
    expect(expand(['abc', 'abd', 'xyz', '𝐀𝐀𝐀'], 'abc', { maxEdits: 0 }).dpRows).toBe(6);
  });

  test('returns nothing when no expansion is allowed', () => {
    expect(expand(VOCABULARY, 'seek', { maxEdits: 2, maxExpansions: 0 }).matches).toEqual([]);
  });
});

describe('expandTerm prefix completions', () => {
  const VOCABULARY = ['sea', 'seal', 'search', 'season', 'set', 'sand'];

  test('completes the query to every term that starts with it, shortest first', () => {
    expect(expand(VOCABULARY, 'sea', { prefix: true }).matches).toEqual([
      'sea exact 0',
      'seal prefix 0',
      'search prefix 0',
      'season prefix 0',
    ]);
  });

  test('completes nothing when prefix matching is off', () => {
    expect(expand(VOCABULARY, 'sea', { prefix: false }).matches).toEqual(['sea exact 0']);
  });

  test.each([
    ['serch', ['searching prefix 1']],
    ['pearch', ['searching prefix 1 first-letter']],
    ['saerch', ['searching prefix 1']],
    ['xyzzy', []],
  ])('completes %j with a typo in the completed part', (query, matches) => {
    expect(expand(['searching'], query, { prefix: true, maxEdits: 1 }).matches).toEqual(matches);
  });

  test('gives each term one kind: exact, else the closest prefix, never a second fuzzy match', () => {
    expect(expand(['seek', 'seeker', 'seem', 'sek', 'seems'], 'seek', { prefix: true, maxEdits: 1 }).matches).toEqual([
      'seek exact 0',
      'seeker prefix 0',
      'sek prefix 1',
      'seem prefix 1',
      'seems prefix 1',
    ]);
  });

  test('keeps the completions without a typo when the cap drops matches with typos', () => {
    const matches = expand(['smirch', 'searching', 'serch', 'searches'], 'search', {
      prefix: true,
      maxEdits: 2,
      maxExpansions: 2,
    }).matches;

    expect(matches).toEqual(['searches prefix 0', 'searching prefix 0']);
  });

  test('cuts at the cap with the shortest completions first, in code point order', () => {
    const matches = expand(['seasonal', 'set', 'search', 'see', 'seek', 'sea'], 'se', {
      prefix: true,
      maxExpansions: 4,
    }).matches;

    expect(matches).toEqual(['sea prefix 0', 'see prefix 0', 'set prefix 0', 'seek prefix 0']);
  });

  test('completes through a node that holds no term itself', () => {
    expect(expand(['search', 'season', 'set'], 'se', { prefix: true }).matches).toEqual([
      'set prefix 0',
      'search prefix 0',
      'season prefix 0',
    ]);
  });

  test('completes an empty query to every term', () => {
    expect(expand(['b', 'ab'], '', { prefix: true }).matches).toEqual(['b prefix 0', 'ab prefix 0']);
  });
});

describe('expandTerm infix matches', () => {
  const VOCABULARY = ['research', 'search', 'sea', 'seasea', 'unsearchable', 'overseas', 'set'];
  const LATIN_SMALL_A = 0x61;
  const LATIN_CAPITAL_A = 0x41;

  function lettersFrom(firstCodePoint: number, count: number): readonly string[] {
    return Array.from({ length: count }, (_, position) => String.fromCodePoint(firstCodePoint + position));
  }

  test('returns every term that holds the query after its first code point, in rank order', () => {
    expect(expand(VOCABULARY, 'sea', { infix: true }).matches).toEqual([
      'sea exact 0',
      'seasea infix 0',
      'overseas infix 0',
      'research infix 0',
      'unsearchable infix 0',
    ]);
  });

  test('keeps a completion without a typo as a prefix match, above the infix matches', () => {
    expect(expand(VOCABULARY, 'sea', { infix: true, prefix: true }).matches).toEqual([
      'sea exact 0',
      'search prefix 0',
      'seasea prefix 0',
      'overseas infix 0',
      'research infix 0',
      'unsearchable infix 0',
    ]);
  });

  test('returns no infix match when infix matching is off', () => {
    expect(expand(VOCABULARY, 'sea', { infix: false }).matches).toEqual(['sea exact 0']);
  });

  test('returns no infix match for a query of 2 code points', () => {
    expect(expand(['seas', 'overseas'], 'ea', { infix: true })).toEqual({ matches: [], dpRows: 2, infixChecks: 0 });
  });

  test('matches a query that holds an astral code point', () => {
    expect(expand(['x𝐀bc', 'x\ud835bc'], '𝐀bc', { infix: true }).matches).toEqual(['x𝐀bc infix 0']);
  });

  test('keeps a term the walk reaches with a typo as an infix match', () => {
    expect(expand(['teach', 'reach'], 'each', { infix: true, maxEdits: 1 }).matches).toEqual([
      'reach infix 0',
      'teach infix 0',
    ]);
  });

  test('ranks an infix match above every match with a typo', () => {
    expect(expand(['bleach', 'etch', 'each'], 'each', { infix: true, prefix: true, maxEdits: 1 }).matches).toEqual([
      'each exact 0',
      'bleach infix 0',
      'etch prefix 1',
    ]);
  });

  test('returns no infix match when the vocabulary lacks one gram of the query', () => {
    expect(expand(['xabcx', 'yabcy'], 'abcd', { infix: true })).toMatchObject({ matches: [], infixChecks: 0 });
  });

  test.each([
    [['xabcd', 'xabcx', 'yabcy'], 1],
    [['xabcd', 'xbcdx', 'ybcdy'], 1],
    [['xabcd', 'xabcx', 'ybcdy'], 2],
  ])('reads only the shortest gram list of %j', (terms, infixChecks) => {
    expect(expand(terms, 'abcd', { infix: true })).toMatchObject({ matches: ['xabcd infix 0'], infixChecks });
  });

  test('reads the leftmost gram list when the shortest lists have the same size', () => {
    const left = { term: 'left-abcd' };
    const right = { term: 'right-abcd' };
    const grams = new Map([
      ['abc', { size: 1, chunks: [[left]] }],
      ['bcd', { size: 1, chunks: [[right]] }],
    ]);

    const { expansions } = expandTerm(vocabularyTree([]).root, grams, 'abcd', { ...EXACT_ONLY, infix: true });

    expect(expansions.map(({ value }) => value)).toEqual([left]);
  });

  test.each([[[1]], [[2]], [[3, 1]], [[512]]])(
    'reads a list cut into chunks of %j entries in order across the chunk boundaries',
    (chunkLengths) => {
      const terms = ['xsea', 'xxsea', 'aasea', 'xxxsea', 'xseax', 'zsea'];

      expect(expand(terms, 'sea', { infix: true }, chunkLengths)).toMatchObject({
        matches: ['xsea infix 0', 'zsea infix 0', 'aasea infix 0', 'xseax infix 0', 'xxsea infix 0', 'xxxsea infix 0'],
        infixChecks: 6,
      });
    },
  );

  test.each([
    [1, [], 20],
    [2, ['zzzabcd infix 0'], 22],
  ])(
    'checks at most 20 listed terms per allowed expansion: %i allowed find %j after %i checks',
    (maxExpansions, matches, infixChecks) => {
      const holdOnlyTheFirstGram = lettersFrom(LATIN_SMALL_A, 21).map((letter) => `${letter}abc`);
      const holdOnlyTheSecondGram = lettersFrom(LATIN_CAPITAL_A, 22).map((letter) => `${letter}bcd`);
      const terms = [...holdOnlyTheFirstGram, ...holdOnlyTheSecondGram, 'zzzabcd'];

      expect(expand(terms, 'abcd', { infix: true, maxExpansions })).toMatchObject({ matches, infixChecks });
    },
  );

  test('stops reading the list once the cap is reached', () => {
    const terms = lettersFrom(LATIN_SMALL_A, 10).map((letter) => `${letter}sea`);

    expect(expand(terms, 'sea', { infix: true, maxExpansions: 3 })).toMatchObject({
      matches: ['asea infix 0', 'bsea infix 0', 'csea infix 0'],
      infixChecks: 4,
    });
  });
});

describe('typoCost', () => {
  test.each([
    [0, false, 0],
    [1, false, 1],
    [1, true, 2],
    [2, true, 3],
  ])('of distance %i with a first-letter typo %s is %i', (distance, firstCharTypo, cost) => {
    expect(typoCost({ distance, firstCharTypo })).toBe(cost);
  });
});

describe('compareExpansions', () => {
  test.each([
    ['a lower typo cost before a better kind', expansion('zzzz', 'fuzzy', 1), expansion('a', 'prefix', 2)],
    [
      'a first-letter typo after the same distance elsewhere',
      expansion('b', 'fuzzy', 1),
      expansion('a', 'fuzzy', 1, true),
    ],
    ['an infix match before any match with a typo', expansion('zzzz', 'infix', 0), expansion('a', 'prefix', 1)],
    ['exact before prefix', expansion('zzzz', 'exact', 0), expansion('a', 'prefix', 0)],
    ['prefix before infix', expansion('zzzz', 'prefix', 0), expansion('a', 'infix', 0)],
    ['infix before fuzzy', expansion('zzzz', 'infix', 1), expansion('a', 'fuzzy', 1)],
    ['a shorter term before a longer one', expansion('zz', 'prefix', 0), expansion('aaa', 'prefix', 0)],
    ['code point order at the same length', expansion('￿', 'prefix', 0), expansion('𝐀', 'prefix', 0)],
  ])('ranks %s', (_rule, first, second) => {
    expect(compareExpansions(first, second)).toBeLessThan(0);
    expect(compareExpansions(second, first)).toBeGreaterThan(0);
  });
});

describe('infixGrams', () => {
  test.each([
    ['banana', ['ana', 'nan']],
    ['search', ['ear', 'arc', 'rch']],
    ['seek', ['eek']],
    ['see', []],
    ['', []],
    ['a𝐀bc𝐀', ['𝐀bc', 'bc𝐀']],
  ])('of %j are %j', (term, grams) => {
    expect(infixGrams(term)).toEqual(grams);
  });
});

describe('occursAfterFirstCodePoint', () => {
  test.each([
    ['research', 'sea', true],
    ['search', 'sea', false],
    ['seasea', 'sea', true],
    ['sea', 'sea', false],
    ['𝐀𝐀b', '𝐀b', true],
    ['𝐀b', '𝐀b', false],
    ['𝐀bc', '\udc00bc', false],
    ['x𝐀bc\udc00bc', '\udc00bc', true],
    ['ab𝐀c', 'b\ud835', false],
    ['abc', 'abcd', false],
  ])('in %j of %j is %s', (text, part, occurs) => {
    expect(occursAfterFirstCodePoint(text, part)).toBe(occurs);
  });
});
