import { afterEach, describe, expect, test, vi } from 'vitest';
import { createIndex, SLICE_BUDGET_MS } from '../../../src/engine/create-index.ts';
import type { AbortSignalLike, AsyncAddOptions, SearchIndex } from '../../../src/types.ts';

interface Note {
  readonly id: number;
  readonly text: string;
}

const NOTES: readonly Note[] = [
  { id: 1, text: 'red fox' },
  { id: 2, text: 'red owl' },
  { id: 3, text: 'red cat' },
];

const READ_BEFORE_PREPARATION = 1;
const READ_DURING_PREPARATION = 3;
const READ_AFTER_TWO_COMMIT_SLICES = 6;

interface BoundaryView {
  readonly size: number;
  readonly found: readonly number[];
}

function noteIndex(): SearchIndex<Note> {
  return createIndex<Note>({ idKey: 'id', keys: ['text'] });
}

function foundIds(index: SearchIndex<Note>): readonly number[] {
  return index.search('red').hits.map((hit) => hit.item.id);
}

function passBudgetOnEveryClockRead(): void {
  let now = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => {
    now += SLICE_BUDGET_MS + 1;
    return now;
  });
}

function watchedSignal(
  index: SearchIndex<Note>,
  abortAtRead: number | undefined,
  reason?: unknown,
): { readonly signal: AbortSignalLike; readonly views: readonly BoundaryView[] } {
  const views: BoundaryView[] = [];
  const signal = {
    get aborted() {
      views.push({ size: index.size, found: foundIds(index) });
      return abortAtRead !== undefined && views.length >= abortAtRead;
    },
    reason,
  };
  return { signal, views };
}

function thrownBy(attempt: () => unknown): unknown {
  try {
    attempt();
  } catch (error: unknown) {
    return error;
  }
  return 'no error';
}

function settled(run: Promise<void>): Promise<unknown> {
  return run.then(
    () => 'resolved',
    (rejection: unknown) => rejection,
  );
}

const busyError: unknown = expect.objectContaining({ name: 'TyposeekError', code: 'INDEX_BUSY' });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FR-13 addAllAsync', () => {
  test('prepares and then commits one record per slice when every clock read passes the budget, yielding to the event loop in between', async () => {
    passBudgetOnEveryClockRead();
    const index = noteIndex();
    const { signal, views } = watchedSignal(index, undefined);
    const seenByOtherTask: number[] = [];
    setTimeout(() => {
      seenByOtherTask.push(index.size);
    }, 0);

    await index.addAllAsync(NOTES, { signal });

    expect(seenByOtherTask).toEqual([0]);
    expect(views).toEqual([
      { size: 0, found: [] },
      { size: 0, found: [] },
      { size: 0, found: [] },
      { size: 0, found: [] },
      { size: 1, found: [1] },
      { size: 2, found: [1, 2] },
    ]);
    expect(foundIds(index)).toEqual([1, 2, 3]);
  });

  test('rejects mutations with INDEX_BUSY during a run while search, has and size see the committed records', async () => {
    passBudgetOnEveryClockRead();
    const index = noteIndex();
    const attempts: unknown[] = [];
    let busyRun: Promise<unknown> = Promise.resolve('not attempted');
    let seen: unknown;
    const signal = {
      get aborted() {
        if (index.size === 1) {
          attempts.push(
            thrownBy(() => {
              index.add({ id: 9, text: 'owl' });
            }),
            thrownBy(() => {
              index.addAll([{ id: 9, text: 'owl' }]);
            }),
            thrownBy(() => {
              index.update({ id: 1, text: 'owl' });
            }),
            thrownBy(() => {
              index.remove(1);
            }),
          );
          busyRun = settled(index.addAllAsync([{ id: 9, text: 'owl' }]));
          seen = { size: index.size, has: [index.has(1), index.has(2)], found: foundIds(index) };
        }
        return false;
      },
    };

    await index.addAllAsync(NOTES, { signal });

    expect(attempts).toEqual([busyError, busyError, busyError, busyError]);
    expect(await busyRun).toEqual(busyError);
    expect(seen).toEqual({ size: 1, has: [true, false], found: [1] });
    index.add({ id: 9, text: 'red owl' });
    expect(foundIds(index)).toEqual([1, 2, 3, 9]);
  });

  test.each([
    ['before preparation', READ_BEFORE_PREPARATION, 0],
    ['during preparation', READ_DURING_PREPARATION, 0],
    ['during commit', READ_AFTER_TWO_COMMIT_SLICES, 2],
  ])(
    'rejects an abort %s with ABORTED whose cause is the signal reason, after rolling back to an unchanged and usable index',
    async (_, abortAtRead, sizeAtAbort) => {
      passBudgetOnEveryClockRead();
      const index = noteIndex();
      const reason = { why: 'user left' };
      const { signal, views } = watchedSignal(index, abortAtRead, reason);

      const error = await settled(index.addAllAsync(NOTES, { signal }));

      expect(error).toEqual(expect.objectContaining({ name: 'TyposeekError', code: 'ABORTED' }));
      expect((error as Error).cause).toBe(reason);
      expect([views.length, views.at(-1)?.size]).toEqual([abortAtRead, sizeAtAbort]);
      expect([index.size, foundIds(index)]).toEqual([0, []]);
      index.addAll(NOTES);
      expect(foundIds(index)).toEqual([1, 2, 3]);
    },
  );

  test('rejects a run whose preparation fails with its typed error, leaving the index unchanged and idle', async () => {
    const index = noteIndex();
    const repeated = { id: 1, text: 'red fox' };

    await expect(index.addAllAsync([repeated, repeated])).rejects.toEqual(
      expect.objectContaining({ name: 'TyposeekError', code: 'DUPLICATE_ID', recordIndex: 1 }),
    );
    expect(index.size).toBe(0);
    index.addAll(NOTES);
    expect(index.size).toBe(3);
  });

  test.each([
    ['options that are null', null],
    ['a signal that is not an object', { signal: true }],
  ])('rejects %s with INVALID_OPTION', async (_, options) => {
    await expect(noteIndex().addAllAsync(NOTES, options as unknown as AsyncAddOptions)).rejects.toEqual(
      expect.objectContaining({ name: 'TyposeekError', code: 'INVALID_OPTION' }),
    );
  });
});
