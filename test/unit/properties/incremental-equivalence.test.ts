import fc from 'fast-check';
import { expect, test } from 'vitest';
import type { ErrorCode } from '../../../src/core/errors.ts';
import { createIndex } from '../../../src/engine/create-index.ts';
import type { SearchIndex } from '../../../src/types.ts';
import { searchRecords } from '../../support/engine.ts';

const RUNS = 1000;
const MAX_ID = 6;
const WHOLE_RESULT = 1000;
const KEYS = ['title', 'tags'] as const;
const STOP_WORDS = ['the'];

interface Note {
  readonly id: number;
  readonly title: string;
  readonly tags: readonly string[];
}

type Operation =
  | { readonly kind: 'add'; readonly note: Note }
  | { readonly kind: 'addAll'; readonly notes: readonly Note[] }
  | { readonly kind: 'update'; readonly note: Note }
  | { readonly kind: 'remove'; readonly id: number };

const word = fc.constantFrom('red', 'reed', 'fox', 'foxes', 'owl', 'bowl', 'night', 'knight', 'the', 'Øre');
const text = fc.array(word, { maxLength: 4 }).map((words) => words.join(' '));
const id = fc.integer({ min: 1, max: MAX_ID });
const note: fc.Arbitrary<Note> = fc.record({ id, title: text, tags: fc.array(text, { maxLength: 2 }) });

const operation: fc.Arbitrary<Operation> = fc.oneof(
  fc.record({ kind: fc.constant('add' as const), note }),
  fc.record({ kind: fc.constant('addAll' as const), notes: fc.array(note, { maxLength: 3 }) }),
  fc.record({ kind: fc.constant('update' as const), note }),
  fc.record({ kind: fc.constant('remove' as const), id }),
);

const queryTerm = fc.oneof(
  word,
  word.map((value) => value.slice(0, 2)),
  fc.constantFrom('fxo', 'nigth', 'ore'),
);
const query = fc.oneof(
  fc.array(queryTerm, { maxLength: 3 }).map((terms) => terms.join(' ')),
  fc.constantFrom('"red fox"', 'owl -bowl', 'the'),
);
const searchOptions = fc.record({ fold: fc.boolean(), mode: fc.constantFrom('and' as const, 'or' as const) });

function addedIdsAreNew(model: ReadonlyMap<number, Note>, notes: readonly Note[]): boolean {
  const ids = notes.map((added) => added.id);
  return new Set(ids).size === ids.length && ids.every((addedId) => !model.has(addedId));
}

function expectedRejection(model: ReadonlyMap<number, Note>, step: Operation): ErrorCode | undefined {
  switch (step.kind) {
    case 'add':
      return addedIdsAreNew(model, [step.note]) ? undefined : 'DUPLICATE_ID';
    case 'addAll':
      return addedIdsAreNew(model, step.notes) ? undefined : 'DUPLICATE_ID';
    case 'update':
      return model.has(step.note.id) ? undefined : 'UNKNOWN_ID';
    case 'remove':
      return model.has(step.id) ? undefined : 'UNKNOWN_ID';
  }
}

function applyToIndex(index: SearchIndex<Note>, step: Operation): void {
  switch (step.kind) {
    case 'add':
      index.add(step.note);
      return;
    case 'addAll':
      index.addAll(step.notes);
      return;
    case 'update':
      index.update(step.note);
      return;
    case 'remove':
      index.remove(step.id);
      return;
  }
}

function applyToModel(model: Map<number, Note>, step: Operation): void {
  switch (step.kind) {
    case 'add':
    case 'update':
      model.set(step.note.id, step.note);
      return;
    case 'addAll':
      for (const added of step.notes) {
        model.set(added.id, added);
      }
      return;
    case 'remove':
      model.delete(step.id);
      return;
  }
}

test('FR-10 after random add, addAll, update and remove sequences an index searches like a fresh index of the final records, and rejected steps change nothing', () => {
  fc.assert(
    fc.property(
      fc.array(operation, { maxLength: 12 }),
      fc.array(fc.tuple(query, searchOptions), { minLength: 1, maxLength: 3 }),
      (steps, searches) => {
        const index = createIndex<Note>({ idKey: 'id', keys: KEYS, stopWords: STOP_WORDS });
        const model = new Map<number, Note>();

        for (const step of steps) {
          const code = expectedRejection(model, step);
          if (code === undefined) {
            applyToIndex(index, step);
            applyToModel(model, step);
          } else {
            expect(() => {
              applyToIndex(index, step);
            }).toThrow(expect.objectContaining({ name: 'TyposeekError', code }));
          }
        }

        const finalNotes = [...model.values()];
        expect(index.size).toBe(finalNotes.length);
        for (const [searched, options] of searches) {
          const resultOptions = { ...options, limit: WHOLE_RESULT };
          expect(index.search(searched, resultOptions)).toEqual(
            searchRecords(finalNotes, { keys: KEYS, stopWords: STOP_WORDS }, searched, resultOptions),
          );
        }
      },
    ),
    { numRuns: RUNS },
  );
});
