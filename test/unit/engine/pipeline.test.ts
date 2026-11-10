import { describe, expect, test } from 'vitest';
import {
  DEFAULT_LIMITS,
  resolveKeySpecs,
  SELF_FIELD,
  type PipelineHooks,
  type ResolvedField,
} from '../../../src/core/options.ts';
import {
  createPipeline,
  isValidId,
  prepareArrayItem,
  prepareRecord,
  processSurface,
  type StopSource,
} from '../../../src/engine/prepare.ts';
import {
  createBatch,
  createState,
  FIELD_BREAK,
  VALUE_BREAK,
  type IndexState,
  type KeyedState,
  type Pipeline,
} from '../../../src/engine/state.ts';
import type { Normalizer } from '../../../src/types.ts';

const DEFAULT_HOOKS: PipelineHooks = { tokenize: undefined, normalize: undefined, stem: undefined };

const NO_STOP_WORDS: StopSource = { kind: 'words', words: [] };

const NON_LETTERS = /[^a-z]/g;

const TRAILING_S = /s$/;

function lettersOnly(text: string): string {
  return text.toLowerCase().replace(NON_LETTERS, '');
}

function countingNormalizer(): { readonly normalize: Normalizer; readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    normalize: (text) => {
      calls.push(text);
      return lettersOnly(text);
    },
  };
}

function typoseekError(code: string): unknown {
  return expect.objectContaining({ name: 'TyposeekError', code });
}

const brokenOutput = (() => 7) as unknown as Normalizer;

function keyedState(
  keys: readonly string[],
  pipeline: Pipeline = createPipeline(DEFAULT_HOOKS, NO_STOP_WORDS),
): KeyedState<unknown> {
  return createState({ fields: resolveKeySpecs(keys), idKey: 'id', pipeline, limits: DEFAULT_LIMITS });
}

function unkeyedState(fields: readonly ResolvedField[]): IndexState<unknown> {
  return createState({
    fields,
    idKey: undefined,
    pipeline: createPipeline(DEFAULT_HOOKS, NO_STOP_WORDS),
    limits: DEFAULT_LIMITS,
  });
}

describe('createPipeline and processSurface', () => {
  test('folds case and diacritics and tokenizes into letter runs when no hooks are given', () => {
    const pipeline = createPipeline(DEFAULT_HOOKS, { kind: 'words', words: [] });

    expect(processSurface(pipeline, 'Ěščř')).toBe('escr');
    expect([...pipeline.tokenize('ab, cd')]).toEqual([
      { start: 0, end: 2 },
      { start: 4, end: 6 },
    ]);
  });

  test.each([
    ['stems the normalized surface', 'Cats', 'cat'],
    ['stops a surface whose normalized form is a stop term', 'THE', undefined],
    ['checks stop terms before stemming', 'Is', undefined],
    ['does not check stop terms after stemming', 'Thes', 'the'],
    ['stops a surface that normalizes to an empty string', '123', undefined],
    ['stops a surface that stems to an empty string', 'Xx', undefined],
  ])('%s', (_, surface, processed) => {
    const pipeline = createPipeline(
      {
        tokenize: undefined,
        normalize: lettersOnly,
        stem: (term) => (term === 'xx' ? '' : term.replace(TRAILING_S, '')),
      },
      { kind: 'words', words: ['The', 'is'] },
    );

    expect(processSurface(pipeline, surface)).toBe(processed);
  });

  test('normalizes each stop word once and drops one that normalizes to an empty string', () => {
    const counting = countingNormalizer();

    const pipeline = createPipeline(
      { ...DEFAULT_HOOKS, normalize: counting.normalize },
      {
        kind: 'words',
        words: ['The', 'AND', 'the', '--'],
      },
    );

    expect([...pipeline.stopTerms]).toEqual(['the', 'and']);
    expect(counting.calls).toEqual(['The', 'AND', 'the', '--']);
  });

  test('takes stop terms from a snapshot as they are, without normalizing them again', () => {
    const counting = countingNormalizer();

    const pipeline = createPipeline(
      { ...DEFAULT_HOOKS, normalize: counting.normalize },
      {
        kind: 'terms',
        terms: ['The', 'and'],
      },
    );

    expect([...pipeline.stopTerms]).toEqual(['The', 'and']);
    expect(counting.calls).toEqual([]);
  });

  test.each([
    [
      'the normalizer on a surface',
      () =>
        processSurface(
          createPipeline({ ...DEFAULT_HOOKS, normalize: brokenOutput }, { kind: 'words', words: [] }),
          'a',
        ),
    ],
    [
      'the stemmer on a surface',
      () => processSurface(createPipeline({ ...DEFAULT_HOOKS, stem: brokenOutput }, { kind: 'words', words: [] }), 'a'),
    ],
    [
      'the normalizer on a stop word',
      () => createPipeline({ ...DEFAULT_HOOKS, normalize: brokenOutput }, { kind: 'words', words: ['a'] }),
    ],
  ])('rejects a non-string result of %s with INVALID_PIPELINE_OUTPUT', (_, run) => {
    expect(run).toThrow(typoseekError('INVALID_PIPELINE_OUTPUT'));
  });
});

describe('isValidId', () => {
  test.each([
    ['a non-empty string', 'a', true],
    ['a numeric string', '0', true],
    ['zero', 0, true],
    ['a negative fraction', -1.5, true],
    ['an empty string', '', false],
    ['__proto__', '__proto__', false],
    ['constructor', 'constructor', false],
    ['prototype', 'prototype', false],
    ['NaN', Number.NaN, false],
    ['Infinity', Number.POSITIVE_INFINITY, false],
    ['a bigint', 1n, false],
    ['null', null, false],
    ['undefined', undefined, false],
    ['an object', {}, false],
  ])('accepts %s: %s', (_, value, accepted) => {
    expect(isValidId(value)).toBe(accepted);
  });
});

describe('prepareRecord rejections', () => {
  function rejection(code: string, recordIndex: number | undefined): unknown {
    return expect.objectContaining({ name: 'TyposeekError', code, recordIndex });
  }

  test.each([
    ['null', null],
    ['an array', [{ id: 'a' }]],
    ['a string', 'a'],
  ])('rejects %s as INVALID_RECORD at its batch position', (_, record) => {
    expect(() => prepareRecord(keyedState(['title']), record, 4, createBatch(), 'add')).toThrow(
      rejection('INVALID_RECORD', 4),
    );
  });

  test.each([
    ['a missing id', { title: 'a' }],
    ['an inherited id', Object.create({ id: 'a' }) as unknown],
    ['an invalid id', { id: '' }],
  ])('rejects %s as INVALID_ID at its batch position', (_, record) => {
    expect(() => prepareRecord(keyedState(['title']), record, 2, createBatch(), 'add')).toThrow(
      rejection('INVALID_ID', 2),
    );
  });

  test('rejects an add of an indexed id, and of an id earlier in the same batch, as DUPLICATE_ID', () => {
    const state = keyedState(['title']);
    state.docNumById.set('indexed', 0);
    const batch = createBatch();
    prepareRecord(state, { id: 'new' }, 0, batch, 'add');

    expect(() => prepareRecord(state, { id: 'indexed' }, 1, batch, 'add')).toThrow(rejection('DUPLICATE_ID', 1));
    expect(() => prepareRecord(state, { id: 'new' }, 2, batch, 'add')).toThrow(rejection('DUPLICATE_ID', 2));
  });

  test('rejects an update of an id the index does not hold as UNKNOWN_ID without a batch position', () => {
    const state = keyedState(['title']);
    state.docNumById.set('indexed', 0);

    expect(prepareRecord(state, { id: 'indexed' }, undefined, createBatch(), 'update').id).toBe('indexed');
    expect(() => prepareRecord(state, { id: 'absent' }, undefined, createBatch(), 'update')).toThrow(
      rejection('UNKNOWN_ID', undefined),
    );
  });

  test('rejects a tokenizer span outside the value as INVALID_TOKEN_SPAN', () => {
    const pipeline = createPipeline({ ...DEFAULT_HOOKS, tokenize: () => [{ start: 0, end: 9 }] }, NO_STOP_WORDS);

    expect(() =>
      prepareRecord(keyedState(['title'], pipeline), { id: 'a', title: 'fox' }, 0, createBatch(), 'add'),
    ).toThrow(typoseekError('INVALID_TOKEN_SPAN'));
  });
});

describe('stream layout', () => {
  test('codes known, batch-repeated and new surfaces, breaks values and key paths, and counts only term tokens', () => {
    const counting = countingNormalizer();
    const state = keyedState(
      ['title', 'tags'],
      createPipeline({ ...DEFAULT_HOOKS, normalize: counting.normalize }, { kind: 'words', words: ['the'] }),
    );
    state.surfaces.set('Fox', { id: 7, surface: 'Fox', term: 'fox', docCount: 1 });
    const batch = createBatch();
    const first = { id: 'a', title: 'The Fox, the fox', tags: ['red fox', '!!', 'Red'] };

    const prepared = [
      prepareRecord(state, first, 0, batch, 'add'),
      prepareRecord(state, { id: 'b', title: 'fox' }, 1, batch, 'add'),
    ];

    expect(prepared.map(({ id, stream }) => [id, [...stream]])).toEqual([
      ['a', [2, 3, -3, 7, -4, -5, FIELD_BREAK, -6, -5, VALUE_BREAK, VALUE_BREAK, -7]],
      ['b', [1, 0, -5, FIELD_BREAK]],
    ]);
    expect(prepared[0]?.item).toBe(first);
    expect(batch.newSurfaces).toEqual([
      { surface: 'The', term: undefined },
      { surface: 'the', term: undefined },
      { surface: 'fox', term: 'fox' },
      { surface: 'red', term: 'red' },
      { surface: 'Red', term: 'red' },
    ]);
    expect([...batch.newSurfaceIndex]).toEqual([
      ['The', 0],
      ['the', 1],
      ['fox', 2],
      ['red', 3],
      ['Red', 4],
    ]);
    expect(counting.calls).toEqual(['the', 'The', 'the', 'fox', 'red', 'Red']);
  });
});

describe('prepareArrayItem', () => {
  test('uses the position as the id and a string item as the single value of the self field', () => {
    const prepared = prepareArrayItem(unkeyedState([SELF_FIELD]), 'Red fox', 3, 'string', createBatch());

    expect([prepared.id, prepared.item, [...prepared.stream]]).toEqual([3, 'Red fox', [2, -3, -4]]);
  });

  test('accepts an object item by reference and reads its key paths', () => {
    const item = { name: 'fox' };

    const prepared = prepareArrayItem(unkeyedState(resolveKeySpecs(['name'])), item, 0, 'object', createBatch());

    expect(prepared.item).toBe(item);
    expect([prepared.id, [...prepared.stream]]).toEqual([0, [1, -3]]);
  });

  test.each([
    ['a number among string items', 5, 'string'],
    ['a string among object items', 'fox', 'object'],
    ['null among object items', null, 'object'],
    ['an array among object items', [], 'object'],
  ] as const)('rejects %s as INVALID_RECORD at its position', (_, item, itemKind) => {
    expect(() => prepareArrayItem(unkeyedState([SELF_FIELD]), item, 2, itemKind, createBatch())).toThrow(
      expect.objectContaining({ name: 'TyposeekError', code: 'INVALID_RECORD', recordIndex: 2 }),
    );
  });
});
