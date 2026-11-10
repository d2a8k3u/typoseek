import { expectTypeOf, test } from 'vitest';
import type { IdKey, KeyPath, KeySpec, TextPath, ValuePath } from '../../src/types.ts';

interface Author {
  readonly name: string;
  readonly born: number;
}

interface Book {
  readonly id: number;
  readonly title: string;
  readonly subtitle?: string;
  readonly note: string | null;
  readonly flag?: boolean;
  readonly owner: { readonly name: string } | null;
  readonly tags: readonly string[];
  readonly authors: readonly Author[];
  readonly publishedAt: Date;
}

interface Shelf {
  readonly label: string;
  readonly room: { readonly name: string; readonly floor: { readonly level: number } };
}

interface Catalogue {
  readonly tags: readonly string[];
  readonly authors: readonly Author[];
  readonly grid: readonly (readonly (number | null)[])[];
}

interface SixLevels {
  readonly a: {
    readonly b: { readonly c: { readonly d: { readonly e: string; readonly f: { readonly g: string } } } };
  };
}

interface Draft {
  readonly title: string;
  readonly retired: undefined;
  readonly removed: null;
}

interface Release {
  readonly name: string;
  readonly at: Date;
  readonly flag?: boolean;
  readonly note: string | null;
}

test('TextPath joins nested object keys with dots', () => {
  expectTypeOf<TextPath<Shelf>>().toEqualTypeOf<'label' | 'room.name' | 'room.floor.level'>();
});

test('TextPath unwraps arrays of leaves, of objects and of arrays', () => {
  expectTypeOf<TextPath<Catalogue>>().toEqualTypeOf<'tags' | 'authors.name' | 'authors.born' | 'grid'>();
});

test('TextPath accepts an optional subtitle and a nullable note, and descends into a nullable owner', () => {
  expectTypeOf<TextPath<Book>>().toEqualTypeOf<
    'id' | 'title' | 'subtitle' | 'note' | 'owner.name' | 'tags' | 'authors.name' | 'authors.born'
  >();
});

test('TextPath accepts a fifth segment and rejects a sixth', () => {
  expectTypeOf<TextPath<SixLevels>>().toEqualTypeOf<'a.b.c.d.e'>();
});

test('ValuePath has no path through a property that is only undefined or only null', () => {
  expectTypeOf<ValuePath<Draft>>().toEqualTypeOf<'title'>();
});

test('ValuePath accepts boolean, Date and nullable leaves', () => {
  expectTypeOf<ValuePath<Release>>().toEqualTypeOf<'name' | 'at' | 'flag' | 'note'>();
});

test('KeyPath keeps only the leaves that extend the given leaf type', () => {
  expectTypeOf<KeyPath<Author, number>>().toEqualTypeOf<'born'>();
});

test('IdKey names the string and number properties', () => {
  expectTypeOf<IdKey<Draft & Author>>().toEqualTypeOf<'title' | 'name' | 'born'>();
});

test('KeySpec accepts a weighted nested path', () => {
  expectTypeOf<{ readonly path: 'authors.name'; readonly weight: 2 }>().toExtend<KeySpec<Book>>();
});

test('rejects the misspelled key path titel', () => {
  // @ts-expect-error titel is not a key path of Book
  expectTypeOf<'titel'>().toExtend<TextPath<Book>>();
});

test('rejects the array property tags as id key', () => {
  // @ts-expect-error tags holds an array, not an Id
  expectTypeOf<'tags'>().toExtend<IdKey<Book>>();
});

test('rejects the optional boolean flag as text key', () => {
  // @ts-expect-error flag?: boolean is not text
  expectTypeOf<'flag'>().toExtend<TextPath<Book>>();
});

test('rejects the nullable object owner as text key', () => {
  // @ts-expect-error owner is an object, only owner.name is text
  expectTypeOf<'owner'>().toExtend<TextPath<Book>>();
});
