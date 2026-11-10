import { describe, expect, test } from 'vitest';
import {
  capQueryLength,
  capTerms,
  checkKeySpecs,
  checkLimits,
  DEFAULT_LIMITS,
  DEFAULT_LOAD_LIMITS,
  isValidIdKey,
  resolveIdKey,
  resolveKeySpecs,
  resolveLimits,
  resolveLoadLimits,
  resolveLoadOptions,
  resolvePipelineOptions,
  resolveSearchOptions,
  SELF_FIELD,
  typoLimit,
} from '../../../src/core/options.ts';
import type { SearchOptions } from '../../../src/types.ts';

function namesOption(option: string): unknown {
  return expect.stringContaining(`${option} `);
}

function invalidOption(option: string): unknown {
  return expect.objectContaining({ name: 'TyposeekError', code: 'INVALID_OPTION', message: namesOption(option) });
}

describe('resolved values', () => {
  test('SELF_FIELD resolves the record itself with weight 1', () => {
    expect(SELF_FIELD).toEqual({ path: '', segments: [], weight: 1 });
  });

  test('are frozen, nested values included', () => {
    const fields = resolveKeySpecs(['a.b']);
    const pipeline = resolvePipelineOptions({ stopWords: ['the'] });
    const load = resolveLoadOptions({});
    const search = resolveSearchOptions({ typos: {} });
    const resolved = [
      DEFAULT_LIMITS,
      DEFAULT_LOAD_LIMITS,
      SELF_FIELD,
      SELF_FIELD.segments,
      resolveLimits({ maxQueryTerms: 2 }),
      resolveLoadLimits({ maxRecords: 2 }),
      fields,
      fields[0],
      fields[0]?.segments,
      pipeline,
      pipeline.hooks,
      pipeline.stopWords,
      load,
      load.hooks,
      load.loadLimits,
      search,
      search.typos,
    ];

    expect(resolved.filter((value) => !Object.isFrozen(value))).toEqual([]);
  });
});

describe('checkLimits', () => {
  test.each([
    ['the defaults without limits', undefined, { maxQueryLength: 256, maxQueryTerms: 16, maxExpansions: 50 }],
    [
      'the defaults for unset limits',
      { maxQueryTerms: 64 },
      { maxQueryLength: 256, maxQueryTerms: 64, maxExpansions: 50 },
    ],
    [
      'every lower bound',
      { maxQueryLength: 1, maxQueryTerms: 1, maxExpansions: 1 },
      { maxQueryLength: 1, maxQueryTerms: 1, maxExpansions: 1 },
    ],
    [
      'every upper bound',
      { maxQueryLength: 4096, maxQueryTerms: 64, maxExpansions: 1000 },
      { maxQueryLength: 4096, maxQueryTerms: 64, maxExpansions: 1000 },
    ],
  ])('accepts %s', (_label, partial, limits) => {
    expect(checkLimits(partial)).toEqual({ limits });
  });

  test.each<[string, unknown, string]>([
    ['a string', 'limits', 'limits'],
    ['null', null, 'limits'],
    ['maxQueryLength below 1', { maxQueryLength: 0 }, 'limits.maxQueryLength'],
    ['maxQueryLength above 4096', { maxQueryLength: 4097 }, 'limits.maxQueryLength'],
    ['maxQueryTerms below 1', { maxQueryTerms: 0 }, 'limits.maxQueryTerms'],
    ['maxQueryTerms above 64', { maxQueryTerms: 65 }, 'limits.maxQueryTerms'],
    ['maxExpansions below 1', { maxExpansions: 0 }, 'limits.maxExpansions'],
    ['maxExpansions above 1000', { maxExpansions: 1001 }, 'limits.maxExpansions'],
    ['a fractional limit', { maxQueryTerms: 2.5 }, 'limits.maxQueryTerms'],
    ['a limit given as text', { maxExpansions: '50' }, 'limits.maxExpansions'],
  ])('reports %s as a problem naming the option', (_label, partial, option) => {
    expect(checkLimits(partial)).toEqual({ problem: namesOption(option) });
  });

  test('resolveLimits returns the checked limits and throws the problem as INVALID_OPTION', () => {
    expect(resolveLimits({ maxExpansions: 1 })).toEqual({ maxQueryLength: 256, maxQueryTerms: 16, maxExpansions: 1 });
    expect(() => resolveLimits({ maxExpansions: 0 })).toThrow(invalidOption('limits.maxExpansions'));
  });
});

describe('resolveLoadLimits', () => {
  const defaults = { maxRecords: 1_000_000, maxSurfaces: 5_000_000, maxTokens: 50_000_000, maxStopTerms: 10_000 };

  test.each([
    ['the defaults without load limits', undefined, defaults],
    ['a large integer with defaults for the rest', { maxTokens: 2 ** 53 }, { ...defaults, maxTokens: 2 ** 53 }],
    [
      'every lower bound',
      { maxRecords: 1, maxSurfaces: 1, maxTokens: 1, maxStopTerms: 1 },
      { maxRecords: 1, maxSurfaces: 1, maxTokens: 1, maxStopTerms: 1 },
    ],
  ])('accepts %s', (_label, partial, loadLimits) => {
    expect(resolveLoadLimits(partial)).toEqual(loadLimits);
  });

  test.each<[string, unknown, string]>([
    ['a number', 5, 'loadLimits'],
    ['maxRecords below 1', { maxRecords: 0 }, 'loadLimits.maxRecords'],
    ['maxSurfaces below 1', { maxSurfaces: 0 }, 'loadLimits.maxSurfaces'],
    ['maxTokens below 1', { maxTokens: 0 }, 'loadLimits.maxTokens'],
    ['maxStopTerms below 1', { maxStopTerms: 0 }, 'loadLimits.maxStopTerms'],
    ['an infinite limit', { maxRecords: Infinity }, 'loadLimits.maxRecords'],
  ])('rejects %s as INVALID_OPTION naming the option', (_label, partial, option) => {
    expect(() => resolveLoadLimits(partial)).toThrow(invalidOption(option));
  });
});

describe('isValidIdKey', () => {
  test.each<[string, unknown, boolean]>([
    ['a property name', 'id', true],
    ['a dotted name, which names one property', 'meta.id', true],
    ['the empty string', '', false],
    ['a forbidden name', 'constructor', false],
    ['a number', 7, false],
  ])('judges %s', (_label, value, valid) => {
    expect(isValidIdKey(value)).toBe(valid);
  });

  test('resolveIdKey returns a valid idKey and throws INVALID_OPTION naming idKey otherwise', () => {
    expect(resolveIdKey('meta.id')).toBe('meta.id');
    expect(() => resolveIdKey('__proto__')).toThrow(invalidOption('idKey'));
  });
});

describe('checkKeySpecs', () => {
  test('resolves path strings with weight 1 and weighted paths into fields', () => {
    expect(
      checkKeySpecs(['title', { path: 'author.name', weight: 2 }, { path: 'tags', weight: Number.MIN_VALUE }]),
    ).toEqual({
      fields: [
        { path: 'title', segments: ['title'], weight: 1 },
        { path: 'author.name', segments: ['author', 'name'], weight: 2 },
        { path: 'tags', segments: ['tags'], weight: Number.MIN_VALUE },
      ],
    });
  });

  test.each<[string, unknown, string]>([
    ['a string', 'title', 'keys'],
    ['an empty array', [], 'keys'],
    ['an entry that is neither a path nor an object', [7], 'keys[0]'],
    ['a path string the parser rejects', ['title', 'a.b.c.d.e.f'], 'keys[1]'],
    ['an object without a path', [{ weight: 1 }], 'keys[0].path'],
    ['an object path the parser rejects', [{ path: 'a.prototype', weight: 1 }], 'keys[0].path'],
    ['an object without a weight', [{ path: 'title' }], 'keys[0].weight'],
    ['a weight of 0', [{ path: 'title', weight: 0 }], 'keys[0].weight'],
    ['an infinite weight', [{ path: 'title', weight: Infinity }], 'keys[0].weight'],
    ['a path given twice', ['title', { path: 'title', weight: 2 }], 'keys[1]'],
  ])('reports %s as a problem naming the option', (_label, specs, option) => {
    expect(checkKeySpecs(specs)).toEqual({ problem: namesOption(option) });
  });

  test('resolveKeySpecs returns the checked fields and throws the problem as INVALID_OPTION', () => {
    expect(resolveKeySpecs(['title'])).toEqual([{ path: 'title', segments: ['title'], weight: 1 }]);
    expect(() => resolveKeySpecs([])).toThrow(invalidOption('keys'));
  });
});

describe('resolvePipelineOptions', () => {
  const tokenize = (): readonly { start: number; end: number }[] => [];
  const normalize = (term: string): string => term.toLowerCase();
  const stem = (term: string): string => term.slice(0, 3);

  function* stopWordsOnce(): Generator<string> {
    yield 'the';
    yield 'a';
  }

  test('keeps absent hooks undefined and no stop words', () => {
    expect(resolvePipelineOptions({})).toEqual({
      hooks: { tokenize: undefined, normalize: undefined, stem: undefined },
      stopWords: [],
    });
  });

  test('keeps the hook functions and reads a single-use stop-word iterable once', () => {
    expect(resolvePipelineOptions({ tokenize, normalize, stem, stopWords: stopWordsOnce() })).toEqual({
      hooks: { tokenize, normalize, stem },
      stopWords: ['the', 'a'],
    });
  });

  test.each<[string, unknown, string]>([
    ['options that are undefined', undefined, 'options'],
    ['options that are null', null, 'options'],
    ['options that are an array', [], 'options'],
    ['a tokenize that is not a function', { tokenize: 'words' }, 'tokenize'],
    ['a normalize that is not a function', { normalize: 1 }, 'normalize'],
    ['a stem that is not a function', { stem: {} }, 'stem'],
    ['stopWords given as a string', { stopWords: 'the' }, 'stopWords'],
    ['stopWords holding a non-string', { stopWords: ['the', 1] }, 'stopWords'],
  ])('rejects %s as INVALID_OPTION naming the option', (_label, options, option) => {
    expect(() => resolvePipelineOptions(options)).toThrow(invalidOption(option));
  });
});

describe('resolveLoadOptions', () => {
  const normalize = (term: string): string => term.toLowerCase();

  test('resolves the hooks and the load limits', () => {
    expect(resolveLoadOptions({ normalize, loadLimits: { maxRecords: 10 } })).toEqual({
      hooks: { tokenize: undefined, normalize, stem: undefined },
      loadLimits: { maxRecords: 10, maxSurfaces: 5_000_000, maxTokens: 50_000_000, maxStopTerms: 10_000 },
    });
  });

  test.each<[string, unknown, string]>([
    ['options that are null', null, 'options'],
    ['own stopWords, which the snapshot holds', { stopWords: [] }, 'stopWords'],
    ['own limits, even undefined, which the snapshot holds', { limits: undefined }, 'limits'],
    ['a stem that is not a function', { stem: 'porter' }, 'stem'],
    ['an invalid load limit', { loadLimits: { maxTokens: 0 } }, 'loadLimits.maxTokens'],
  ])('rejects %s as INVALID_OPTION naming the option', (_label, options, option) => {
    expect(() => resolveLoadOptions(options)).toThrow(invalidOption(option));
  });
});

describe('resolveSearchOptions', () => {
  interface Row {
    readonly n: number;
  }

  const defaults = {
    mode: 'and',
    prefix: true,
    infix: true,
    typos: { minLengthForOne: 4, minLengthForTwo: 8 },
    fold: true,
    filter: undefined,
    sortBy: undefined,
    limit: 20,
    offset: 0,
    truncateQuery: false,
  };

  test.each<[string, SearchOptions<Row> | undefined, object]>([
    ['the defaults without options', undefined, {}],
    [
      'every flag set against its default',
      { mode: 'or', prefix: false, infix: false, fold: false, truncateQuery: true },
      { mode: 'or', prefix: false, infix: false, fold: false, truncateQuery: true },
    ],
    ['limit 0 and a large offset', { limit: 0, offset: 2 ** 40 }, { limit: 0, offset: 2 ** 40 }],
    ['limit 1000', { limit: 1000 }, { limit: 1000 }],
    ['typos turned off', { typos: false }, { typos: false }],
    [
      'two edits from the same length as one',
      { typos: { minLengthForOne: 1, minLengthForTwo: 1 } },
      { typos: { minLengthForOne: 1, minLengthForTwo: 1 } },
    ],
    [
      'two edits disabled by Infinity',
      { typos: { minLengthForTwo: Infinity } },
      { typos: { minLengthForOne: 4, minLengthForTwo: Infinity } },
    ],
  ])('resolves %s', (_label, options, expected) => {
    expect(resolveSearchOptions(options)).toEqual({ ...defaults, ...expected });
  });

  test('compiles filter and sortBy', () => {
    const resolved = resolveSearchOptions<Row>({ filter: { key: 'n', equals: 1 }, sortBy: { key: 'n' } });

    expect([{ n: 1 }, { n: 2 }].filter((row) => resolved.filter?.(row) === true)).toEqual([{ n: 1 }]);
    expect(resolved.sortBy?.keyOf({ n: 3 })).toEqual({ kind: 'number', value: 3 });
  });

  test.each<[string, unknown, string]>([
    ['options that are null', null, 'options'],
    ['an unknown mode', { mode: 'xor' }, 'mode'],
    ['a prefix that is not a boolean', { prefix: 'yes' }, 'prefix'],
    ['an infix that is not a boolean', { infix: 1 }, 'infix'],
    ['a fold that is not a boolean', { fold: null }, 'fold'],
    ['a truncateQuery that is not a boolean', { truncateQuery: 'true' }, 'truncateQuery'],
    ['limit below 0', { limit: -1 }, 'limit'],
    ['limit above 1000', { limit: 1001 }, 'limit'],
    ['offset below 0', { offset: -1 }, 'offset'],
    ['typos that are true', { typos: true }, 'typos'],
    ['minLengthForOne below 1', { typos: { minLengthForOne: 0 } }, 'typos.minLengthForOne'],
    [
      'minLengthForTwo below minLengthForOne',
      { typos: { minLengthForOne: 5, minLengthForTwo: 4 } },
      'typos.minLengthForTwo',
    ],
    ['minLengthForOne above the default minLengthForTwo', { typos: { minLengthForOne: 9 } }, 'typos.minLengthForTwo'],
    ['a fractional minLengthForTwo', { typos: { minLengthForTwo: 8.5 } }, 'typos.minLengthForTwo'],
    ['an invalid filter', { filter: 'n' }, 'filter'],
    ['an invalid sortBy', { sortBy: 'n' }, 'sortBy'],
  ])('rejects %s as INVALID_OPTION naming the option', (_label, options, option) => {
    expect(() => resolveSearchOptions(options as SearchOptions<Row>)).toThrow(invalidOption(option));
  });
});

describe('capQueryLength', () => {
  const cap = DEFAULT_LIMITS.maxQueryLength;
  const astral = '𝐀';
  const atCap = astral.repeat(cap);
  const overCap = astral.repeat(cap + 1);

  test('keeps a query of exactly the cap in code points', () => {
    expect(capQueryLength(atCap, cap, false)).toBe(atCap);
  });

  test('rejects one code point over the cap as QUERY_TOO_LONG without echoing the query', () => {
    const withoutQueryText: unknown = expect.not.stringContaining(astral);

    expect(() => capQueryLength(overCap, cap, false)).toThrow(
      expect.objectContaining({ name: 'TyposeekError', code: 'QUERY_TOO_LONG', message: withoutQueryText }),
    );
  });

  test('truncates to the first cap code points when truncation is on', () => {
    expect(capQueryLength(overCap, cap, true)).toBe(atCap);
  });
});

describe('capTerms', () => {
  const cap = DEFAULT_LIMITS.maxQueryTerms;
  const atCap = Array.from({ length: cap }, (_, index) => index);
  const overCap = [...atCap, cap];

  test('keeps exactly the cap of terms', () => {
    expect(capTerms(atCap, cap, false)).toEqual(atCap);
  });

  test('rejects one term over the cap as TOO_MANY_TERMS', () => {
    expect(() => capTerms(overCap, cap, false)).toThrow(
      expect.objectContaining({ name: 'TyposeekError', code: 'TOO_MANY_TERMS' }),
    );
  });

  test('keeps the first cap terms when truncation is on', () => {
    expect(capTerms(overCap, cap, true)).toEqual(atCap);
  });
});

describe('typoLimit', () => {
  const defaultTypos = { minLengthForOne: 4, minLengthForTwo: 8 };
  const oneEditOnly = { minLengthForOne: 1, minLengthForTwo: Infinity };

  test.each([
    [defaultTypos, 3, 0],
    [defaultTypos, 4, 1],
    [defaultTypos, 7, 1],
    [defaultTypos, 8, 2],
    [oneEditOnly, 0, 0],
    [oneEditOnly, 1, 1],
    [oneEditOnly, 1000, 1],
  ])('allows %o at %i code points %i edits', (typos, length, edits) => {
    expect(typoLimit(length, typos)).toBe(edits);
  });
});
