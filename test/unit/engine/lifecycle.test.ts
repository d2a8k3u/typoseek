import { afterEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_LIMITS, resolveKeySpecs, type PipelineHooks } from '../../../src/core/options.ts';
import { indexFromState, SLICE_BUDGET_MS } from '../../../src/engine/create-index.ts';
import { createPipeline } from '../../../src/engine/prepare.ts';
import {
  averageFieldLength,
  commitRecords,
  createBatch,
  createState,
  FIELD_BREAK,
  GRAM_CHUNK_CAPACITY,
  MAX_INFIX_TERM_LENGTH,
  MAX_SURFACE_ID,
  pruneSurfaces,
  retractRecord,
  type GramList,
  type KeyedState,
} from '../../../src/engine/state.ts';
import type { Id, SearchIndex } from '../../../src/types.ts';

const DEFAULT_HOOKS: PipelineHooks = { tokenize: undefined, normalize: undefined, stem: undefined };

function keyedState(keys: readonly string[], stopWords: readonly string[] = []): KeyedState<unknown> {
  return createState({
    fields: resolveKeySpecs(keys),
    idKey: 'id',
    pipeline: createPipeline(DEFAULT_HOOKS, { kind: 'words', words: stopWords }),
    limits: DEFAULT_LIMITS,
  });
}

function addAll(state: KeyedState<unknown>, records: readonly unknown[]): void {
  indexFromState(state).addAll(records);
}

function remove(state: KeyedState<unknown>, id: Id): void {
  indexFromState(state).remove(id);
}

function update(state: KeyedState<unknown>, record: unknown): void {
  indexFromState(state).update(record);
}

function surfaceTable(state: KeyedState<unknown>): readonly (readonly [string, number, string | undefined, number])[] {
  return [...state.surfaces.values()].map(({ surface, id, term, docCount }) => [surface, id, term, docCount] as const);
}

function termTable(state: KeyedState<unknown>, terms: readonly string[]): readonly unknown[] {
  return terms.map((term) => {
    const entry = state.terms.get(term);
    return entry === undefined ? [term] : [term, [...entry.postings], entry.surfaceIds];
  });
}

function docTable(state: KeyedState<unknown>): readonly unknown[] {
  return [...state.docs].map(([docNum, doc]) => [docNum, doc.id, [...doc.stream]]);
}

function freshBuild(state: KeyedState<unknown>): KeyedState<unknown> {
  const fresh: KeyedState<unknown> = createState(state.config);
  addAll(
    fresh,
    [...state.docs.values()].map((doc) => doc.item),
  );
  return fresh;
}

function listedTerms(list: GramList): string {
  return list.chunks.flatMap((chunk) => chunk.map((entry) => entry.term)).join(' ');
}

function gramTable(grams: ReadonlyMap<string, GramList>): Readonly<Record<string, string>> {
  return Object.fromEntries([...grams].map(([gram, list]) => [gram, listedTerms(list)]));
}

const MIN_MULTI_CHUNK_SIZE = GRAM_CHUNK_CAPACITY / 4;

function chunkViolations(grams: ReadonlyMap<string, GramList>): readonly string[] {
  return [...grams].flatMap(([gram, { size, chunks }]) => {
    const sizes = chunks.map((chunk) => chunk.length);
    const smallest = chunks.length > 1 ? MIN_MULTI_CHUNK_SIZE : 1;
    const entryCount = sizes.reduce((sum, chunkSize) => sum + chunkSize, 0);
    const fits =
      sizes.length > 0 && sizes.every((chunkSize) => chunkSize >= smallest && chunkSize <= GRAM_CHUNK_CAPACITY);
    return fits && size === entryCount ? [] : [`${gram}: size ${String(size)}, chunks ${sizes.join(',')}`];
  });
}

function expectGramInvariant(state: KeyedState<unknown>): void {
  expect(gramTable(state.grams)).toEqual(gramTable(freshBuild(state).grams));
  expect(chunkViolations(state.grams)).toEqual([]);
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

const SHARED_GRAM = 'abc';

function sharedGramTerm(rank: number): string {
  const letterAt = (place: number): string =>
    LETTERS.charAt(Math.floor(rank / LETTERS.length ** place) % LETTERS.length);
  return `z${SHARED_GRAM}${letterAt(2)}${letterAt(1)}${letterAt(0)}`;
}

function recordsAtRanks(termRanks: readonly number[]): readonly { readonly id: number; readonly title: string }[] {
  return termRanks.map((rank) => ({ id: rank, title: sharedGramTerm(rank) }));
}

function ranks(first: number, count: number, step = 1): readonly number[] {
  return Array.from({ length: count }, (_, offset) => first + offset * step);
}

function sharedGramRecords(
  firstRank: number,
  count: number,
): readonly { readonly id: number; readonly title: string }[] {
  return recordsAtRanks(ranks(firstRank, count));
}

function addEach(state: KeyedState<unknown>, records: readonly unknown[]): void {
  for (const record of records) {
    addAll(state, [record]);
  }
}

function removeEach(state: KeyedState<unknown>, ids: readonly Id[]): void {
  for (const id of ids) {
    remove(state, id);
  }
}

function chunkSizes(state: KeyedState<unknown>, gram: string): readonly number[] | undefined {
  return state.grams.get(gram)?.chunks.map((chunk) => chunk.length);
}

const RECORD_A = { id: 'a', title: 'Red red fox', body: 'the fox' };
const RECORD_B = { id: 'b', title: 'fox' };

function stateWithTwoRecords(): KeyedState<unknown> {
  const state = keyedState(['title', 'body'], ['the']);
  addAll(state, [RECORD_A, RECORD_B]);
  return state;
}

describe('commit, retract and prune', () => {
  test('commits records with ids for new surfaces, postings per term and key path, and field length sums', () => {
    const state = stateWithTwoRecords();

    expect(surfaceTable(state)).toEqual([
      ['Red', 0, 'red', 1],
      ['red', 1, 'red', 1],
      ['fox', 2, 'fox', 2],
      ['the', 3, undefined, 1],
    ]);
    expect([...state.surfacesById.keys()]).toEqual([0, 1, 2, 3]);
    expect(termTable(state, ['red', 'fox', 'the'])).toEqual([
      ['red', [[0, 2]], [0, 1]],
      [
        'fox',
        [
          [0, 1],
          [1, 1],
          [2, 1],
        ],
        [2],
      ],
      ['the'],
    ]);
    expect(docTable(state)).toEqual([
      [0, 'a', [3, 1, 0, 1, 2, FIELD_BREAK, 3, 2]],
      [1, 'b', [1, 0, 2, FIELD_BREAK]],
    ]);
    expect(state.docs.get(0)?.item).toBe(RECORD_A);
    expect([...state.docNumById]).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
    expect(state.lengthSums).toEqual([4, 1]);
    expect([state.nextDocNum, state.nextSurfaceId]).toEqual([2, 4]);
  });

  test('retracts a record and prunes the surfaces and terms only it used, stop surfaces included', () => {
    const state = stateWithTwoRecords();

    const retracted = retractRecord(state, 0);
    pruneSurfaces(state, retracted);

    expect([...retracted]).toEqual([0, 1, 2, 3]);
    expect(surfaceTable(state)).toEqual([['fox', 2, 'fox', 1]]);
    expect([...state.surfacesById.keys()]).toEqual([2]);
    expect(termTable(state, ['red', 'fox'])).toEqual([['red'], ['fox', [[2, 1]], [2]]]);
    expect(state.lengthSums).toEqual([1, 0]);
    expect(state.freeSurfaceIds).toEqual([0, 1, 3]);
  });

  test('retracts the postings of a later record under its own docNum and key path, leaving the others', () => {
    const state = stateWithTwoRecords();

    remove(state, 'b');

    expect(termTable(state, ['fox'])).toEqual([
      [
        'fox',
        [
          [0, 1],
          [1, 1],
        ],
        [2],
      ],
    ]);
  });

  test('updates a record in place, keeping its docNum and the surfaces its new version still uses', () => {
    const state = stateWithTwoRecords();
    const updated = { id: 'a', title: 'fox', body: 'blue' };

    update(state, updated);

    expect(surfaceTable(state)).toEqual([
      ['fox', 2, 'fox', 2],
      ['blue', 4, 'blue', 1],
    ]);
    expect(termTable(state, ['red', 'fox', 'blue'])).toEqual([
      ['red'],
      [
        'fox',
        [
          [2, 1],
          [0, 1],
        ],
        [2],
      ],
      ['blue', [[1, 1]], [4]],
    ]);
    expect(docTable(state)).toEqual([
      [0, 'a', [1, 1, 2, FIELD_BREAK, 4]],
      [1, 'b', [1, 0, 2, FIELD_BREAK]],
    ]);
    expect(state.docs.get(0)?.item).toBe(updated);
    expect(state.lengthSums).toEqual([2, 1]);
    expect([state.nextDocNum, state.nextSurfaceId, state.freeSurfaceIds]).toEqual([2, 5, [0, 1, 3]]);
  });
});

describe('gram lists', () => {
  test('lists each committed term under every gram after its first code point, in rank order', () => {
    const state = keyedState(['title']);

    addAll(state, [
      { id: 1, title: 'searches research' },
      { id: 2, title: 'searcher' },
    ]);

    expect(gramTable(state.grams)).toEqual({
      ese: 'research',
      sea: 'research',
      ear: 'research searcher searches',
      arc: 'research searcher searches',
      rch: 'research searcher searches',
      che: 'searcher searches',
      hes: 'searches',
      her: 'searcher',
    });
  });

  test('takes pruned terms out of their lists and deletes a list with its last term', () => {
    const state = keyedState(['title']);
    addAll(state, [
      { id: 1, title: 'searches research' },
      { id: 2, title: 'searcher' },
    ]);

    remove(state, 1);

    expect(gramTable(state.grams)).toEqual({
      ear: 'searcher',
      arc: 'searcher',
      rch: 'searcher',
      che: 'searcher',
      her: 'searcher',
    });
    expectGramInvariant(state);

    update(state, { id: 2, title: 'preacher' });

    expect(gramTable(state.grams)).toEqual({
      rea: 'preacher',
      eac: 'preacher',
      ach: 'preacher',
      che: 'preacher',
      her: 'preacher',
    });
    expectGramInvariant(state);
  });

  test(`removes a term longer than ${String(MAX_INFIX_TERM_LENGTH)} code points without touching a list, since no list holds it`, () => {
    const state = keyedState(['title']);
    addAll(state, [
      { id: 1, title: 'searcher' },
      { id: 2, title: 'r'.repeat(MAX_INFIX_TERM_LENGTH + 1) },
    ]);
    const listedBeforeRemoval = gramTable(state.grams);

    remove(state, 2);

    expect(gramTable(state.grams)).toEqual(listedBeforeRemoval);
    expectGramInvariant(state);
  });

  test('cuts a list that one commit creates evenly into chunks of at most half the capacity', () => {
    const state = keyedState(['title']);

    addAll(state, sharedGramRecords(0, 600));

    expect(chunkSizes(state, SHARED_GRAM)).toEqual([200, 200, 200]);
    expectGramInvariant(state);
  });

  test('inserts single adds into their chunk and splits a chunk in halves only once it passes the capacity', () => {
    const state = keyedState(['title']);
    addAll(state, sharedGramRecords(0, 600));

    addEach(state, sharedGramRecords(600, 312));

    expect(chunkSizes(state, SHARED_GRAM)).toEqual([200, 200, 512]);
    expectGramInvariant(state);

    addEach(state, sharedGramRecords(912, 1));

    expect(chunkSizes(state, SHARED_GRAM)).toEqual([200, 200, 256, 257]);
    expectGramInvariant(state);
  });

  test('inserts the entries of a commit one by one while their count times the capacity stays below the list size', () => {
    const state = keyedState(['title']);
    addAll(state, recordsAtRanks(ranks(0, 1025, 2)));

    addAll(state, recordsAtRanks([1, 3]));

    expect(chunkSizes(state, SHARED_GRAM)).toEqual([207, 205, 205, 205, 205]);
    expectGramInvariant(state);
  });

  test('merges the entries of a commit and cuts the list again evenly once their count times the capacity reaches its size', () => {
    const state = keyedState(['title']);
    addAll(state, recordsAtRanks(ranks(0, 1024, 2)));

    addAll(state, recordsAtRanks([1, 3]));

    const sizes = chunkSizes(state, SHARED_GRAM) ?? [];
    expect([sizes.length, Math.max(...sizes) - Math.min(...sizes)]).toEqual([5, 1]);
    expectGramInvariant(state);
  });

  test.each([
    ['keeps a chunk at exactly a quarter of the capacity', [], ranks(0, 72), [128, 200, 200]],
    ['merges a chunk below a quarter of the capacity with its next chunk', [], ranks(0, 73), [327, 200]],
    ['merges the last chunk below a quarter of the capacity with its previous chunk', [], ranks(400, 73), [200, 327]],
    ['splits a merged chunk that passes the capacity in halves', ranks(600, 200), ranks(200, 73), [200, 263, 264]],
  ])('%s', (_, addedRanks, removedRanks, expectedSizes) => {
    const state = keyedState(['title']);
    addAll(state, sharedGramRecords(0, 600));
    addEach(state, recordsAtRanks(addedRanks));

    removeEach(state, removedRanks);

    expect(chunkSizes(state, SHARED_GRAM)).toEqual(expectedSizes);
    expectGramInvariant(state);
  });

  test('keeps a list that removals fragment within 4 × size / capacity + 1 chunks', () => {
    const state = keyedState(['title']);
    addAll(state, sharedGramRecords(0, 2048));
    const firstOfEachChunk = new Set(ranks(0, 8, 256));

    removeEach(
      state,
      ranks(0, 2048).filter((rank) => !firstOfEachChunk.has(rank)),
    );

    const list = state.grams.get(SHARED_GRAM);
    expect(list?.size).toBe(8);
    expect(list?.chunks.length).toBeLessThanOrEqual((4 * 8) / GRAM_CHUNK_CAPACITY + 1);
    expectGramInvariant(state);
  });
});

const INVARIANT_VIOLATION = /^typoseek invariant violated: /;

describe('surface ids', () => {
  test('reuses pruned ids first, so nextSurfaceId stays at the peak live surface count over 1,000 add and remove cycles', () => {
    const state = keyedState(['title']);
    addAll(state, [{ id: 'kept', title: 'kept' }]);

    for (const cycle of ranks(0, 1000)) {
      addAll(state, [{ id: cycle, title: `w${String(cycle)}a w${String(cycle)}b` }]);
      remove(state, cycle);
    }

    expect(state.nextSurfaceId).toBe(3);
    expect([...state.surfacesById.keys()]).toEqual([0]);
    expect([...state.freeSurfaceIds].sort()).toEqual([1, 2]);
    expectGramInvariant(state);
  });

  test('assigns MAX_SURFACE_ID and throws the invariant error on the allocation past it', () => {
    const state = keyedState(['title']);
    state.nextSurfaceId = MAX_SURFACE_ID;

    addAll(state, [{ id: 1, title: 'last' }]);

    expect([...(state.docs.get(0)?.stream ?? [])]).toEqual([1, MAX_SURFACE_ID]);
    expect(() => {
      addAll(state, [{ id: 2, title: 'past' }]);
    }).toThrow(INVARIANT_VIOLATION);
  });
});

describe('invariant violations', () => {
  test.each([
    [
      'a stream slot with an unknown surface id',
      (state: KeyedState<unknown>) => {
        commitRecords(state, [{ id: 'x', item: {}, stream: Int32Array.from([1, 99]) }], 0, createBatch());
      },
    ],
    [
      'a stream slot with a batch code its batch does not hold',
      (state: KeyedState<unknown>) => {
        commitRecords(state, [{ id: 'x', item: {}, stream: Int32Array.from([1, -3]) }], 0, createBatch());
      },
    ],
    ['a retract of a docNum that is not indexed', (state: KeyedState<unknown>) => retractRecord(state, 7)],
    [
      'a prune of a surface its term does not list',
      (state: KeyedState<unknown>) => {
        addAll(state, [{ id: 'a', title: 'fox' }]);
        state.terms.get('fox')?.surfaceIds.pop();
        remove(state, 'a');
      },
    ],
    [
      'an average over a field index outside the key paths',
      (state: KeyedState<unknown>) => averageFieldLength(state, 1),
    ],
  ])('throws the invariant error on %s', (_, run) => {
    expect(() => {
      run(keyedState(['title']));
    }).toThrow(INVARIANT_VIOLATION);
  });
});

function indexedTables(state: KeyedState<unknown>): unknown {
  const terms = [...state.surfaces.values()].flatMap(({ term }) => (term === undefined ? [] : [term]));
  return {
    docs: docTable(state),
    docNumById: [...state.docNumById],
    surfaces: surfaceTable(state),
    terms: termTable(state, terms),
    grams: gramTable(state.grams),
    lengthSums: [...state.lengthSums],
  };
}

function stateTables(state: KeyedState<unknown>): unknown {
  return {
    indexed: indexedTables(state),
    allocation: [state.nextDocNum, state.nextSurfaceId, [...state.freeSurfaceIds]],
  };
}

describe('an addAllAsync aborted during commit', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('rolls back to the indexed state before the run, with the gram invariant of a fresh build', async () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      now += SLICE_BUDGET_MS + 1;
      return now;
    });
    const state = keyedState(['title']);
    const index = indexFromState(state);
    index.addAll(sharedGramRecords(0, 600));
    const before = indexedTables(state);
    const signal = {
      get aborted() {
        return state.docs.size === 602;
      },
    };

    await expect(index.addAllAsync(sharedGramRecords(600, 3), { signal })).rejects.toEqual(
      expect.objectContaining({ code: 'ABORTED' }),
    );

    expect(indexedTables(state)).toEqual(before);
    expectGramInvariant(state);
  });
});

describe('FR-10 typed rejections through the index', () => {
  test.each<readonly [string, (index: SearchIndex<unknown>) => void, string, number | undefined]>([
    [
      'an add of an indexed id',
      (index) => {
        index.add({ id: 'b', title: 'cat' });
      },
      'DUPLICATE_ID',
      0,
    ],
    [
      'an addAll that repeats an id of the batch',
      (index) => {
        index.addAll([
          { id: 'c', title: 'cat' },
          { id: 'c', title: 'cow' },
        ]);
      },
      'DUPLICATE_ID',
      1,
    ],
    [
      'an addAll whose last record is invalid',
      (index) => {
        index.addAll([{ id: 'c', title: 'cat owl' }, null]);
      },
      'INVALID_RECORD',
      1,
    ],
    [
      'an update of an unknown id',
      (index) => {
        index.update({ id: 'z', title: 'cat' });
      },
      'UNKNOWN_ID',
      undefined,
    ],
    [
      'a remove of an unknown id',
      (index) => {
        index.remove('z');
      },
      'UNKNOWN_ID',
      undefined,
    ],
    [
      'a remove of an invalid id',
      (index) => {
        index.remove('__proto__');
      },
      'INVALID_ID',
      undefined,
    ],
  ])('rejects %s with its code and leaves the index unchanged', (_, run, code, recordIndex) => {
    const state = stateWithTwoRecords();
    const index = indexFromState(state);
    const before = stateTables(state);

    expect(() => {
      run(index);
    }).toThrow(expect.objectContaining({ name: 'TyposeekError', code, recordIndex }));
    expect(stateTables(state)).toEqual(before);
  });
});

describe('averageFieldLength', () => {
  test('averages the field lengths of one key path over the indexed records, and is 0 without records', () => {
    expect([averageFieldLength(stateWithTwoRecords(), 0), averageFieldLength(stateWithTwoRecords(), 1)]).toEqual([
      2, 0.5,
    ]);
    expect(averageFieldLength(keyedState(['title']), 0)).toBe(0);
  });
});
