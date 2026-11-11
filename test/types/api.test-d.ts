import { expectTypeOf, test } from 'vitest';
import { createIndex, search } from '../../src/index.ts';
import { loadIndex } from '../../src/serialize.ts';
import type {
  ArrayHit,
  Id,
  IdKey,
  IndexHit,
  KeyPath,
  KeySpec,
  LoadLimits,
  LoadOptions,
  SearchIndex,
  SearchResponse,
  TextPath,
  ValuePath,
} from '../../src/types.ts';

declare const snapshot: unknown;
declare const books: readonly Book[];
declare const words: readonly string[];

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

test('createIndex with Book returns SearchIndex of Book', () => {
  expectTypeOf(createIndex<Book>({ idKey: 'id', keys: ['title'] })).toEqualTypeOf<SearchIndex<Book>>();
});

test('index search types its hits as IndexHit of Book', () => {
  const index = createIndex<Book>({ idKey: 'id', keys: ['title'] });
  expectTypeOf(index.search('dune').hits).toEqualTypeOf<readonly IndexHit<Book>[]>();
});

test('an index hit id is an Id and its item is a Book', () => {
  const index = createIndex<Book>({ idKey: 'id', keys: ['title'] });
  const [hit] = index.search('dune').hits;
  expectTypeOf(hit).toEqualTypeOf<IndexHit<Book> | undefined>();
  expectTypeOf<IndexHit<Book>['id']>().toEqualTypeOf<Id>();
});

test('createIndex accepts the optional subtitle as a key', () => {
  expectTypeOf(createIndex<Book>({ idKey: 'id', keys: ['subtitle'] })).toEqualTypeOf<SearchIndex<Book>>();
});

test('createIndex accepts the nullable note as a key', () => {
  expectTypeOf(createIndex<Book>({ idKey: 'id', keys: ['note'] })).toEqualTypeOf<SearchIndex<Book>>();
});

test('createIndex accepts a weighted nested key through an array and a nullable object', () => {
  const keys = [
    { path: 'authors.name', weight: 2 },
    { path: 'owner.name', weight: 1 },
  ] as const;
  expectTypeOf(createIndex<Book>({ idKey: 'id', keys })).toEqualTypeOf<SearchIndex<Book>>();
});

test('search over strings returns ArrayHit of string', () => {
  expectTypeOf(search(words, 'dune')).toEqualTypeOf<SearchResponse<ArrayHit<string>>>();
});

test('search over objects infers the item type from items only', () => {
  expectTypeOf(search(books, 'dune', { keys: ['title'] })).toEqualTypeOf<SearchResponse<ArrayHit<Book>>>();
});

test('search over objects types the filter callback item as the item type', () => {
  search(books, 'dune', {
    keys: ['title'],
    filter: (item) => {
      expectTypeOf(item).toEqualTypeOf<Book>();
      return true;
    },
  });
});

test('search over strings types the filter callback item as string', () => {
  search(words, 'dune', {
    filter: (item) => {
      expectTypeOf(item).toEqualTypeOf<string>();
      return true;
    },
  });
});

test('loadIndex with Book returns SearchIndex of Book', () => {
  expectTypeOf(loadIndex<Book>(snapshot)).toEqualTypeOf<SearchIndex<Book>>();
});

test('loadIndex without a type argument returns SearchIndex of object', () => {
  expectTypeOf(loadIndex(snapshot)).toEqualTypeOf<SearchIndex<object>>();
});

test('LoadOptions loadLimits is a Partial of LoadLimits with maxTextLength', () => {
  expectTypeOf<Required<LoadOptions>['loadLimits']>().toEqualTypeOf<Partial<LoadLimits>>();
  expectTypeOf<keyof LoadLimits>().toEqualTypeOf<
    'maxRecords' | 'maxSurfaces' | 'maxTokens' | 'maxStopTerms' | 'maxTextLength'
  >();
});

test('rejects the misspelled key titel in createIndex', () => {
  // @ts-expect-error titel is not a key path of Book
  createIndex<Book>({ idKey: 'id', keys: ['titel'] });
});

test('rejects the array property tags as idKey in createIndex', () => {
  // @ts-expect-error tags holds an array, not an Id
  createIndex<Book>({ idKey: 'tags', keys: ['title'] });
});

test('rejects the misspelled filter key titel in index search', () => {
  const index = createIndex<Book>({ idKey: 'id', keys: ['title'] });
  // @ts-expect-error titel is not a value path of Book
  index.search('dune', { filter: { key: 'titel', equals: 'Dune' } });
});

test('rejects the unknown option fuzzy in index search', () => {
  const index = createIndex<Book>({ idKey: 'id', keys: ['title'] });
  // @ts-expect-error fuzzy is not a search option
  index.search('dune', { fuzzy: true });
});

test('rejects a string range bound in a range filter', () => {
  const index = createIndex<Book>({ idKey: 'id', keys: ['title'] });
  // @ts-expect-error a range bound is a number or a Date, not a string
  index.search('dune', { filter: { key: 'publishedAt', range: { gt: '2020-01-01' } } });
});

test('rejects createIndex without a type argument', () => {
  // @ts-expect-error without a type argument T is object, so IdKey is never
  createIndex({ idKey: 'id', keys: ['title'] });
});

test('rejects a misspelled idKey without a type argument', () => {
  // @ts-expect-error without a type argument a misspelled idKey cannot widen T
  createIndex({ idKey: 'idd', keys: ['title'] });
});

test('rejects the optional boolean flag as a createIndex key', () => {
  // @ts-expect-error flag?: boolean is not text
  createIndex<Book>({ idKey: 'id', keys: ['flag'] });
});

test('rejects the nullable object owner as a createIndex key', () => {
  // @ts-expect-error owner is an object, only owner.name is text
  createIndex<Book>({ idKey: 'id', keys: ['owner'] });
});

test('rejects a key filter on string items', () => {
  // @ts-expect-error string items take a filter callback only, not a key filter
  search(words, 'dune', { filter: { key: 'length', equals: 4 } });
});

test('rejects sortBy on string items', () => {
  // @ts-expect-error string items have no sortBy
  search(words, 'dune', { sortBy: { key: 'length' } });
});

test('rejects the misspelled key titel in search over objects', () => {
  // @ts-expect-error titel is not a key path of Book
  search(books, 'dune', { keys: ['titel'] });
});

test('rejects stopWords in LoadOptions', () => {
  // @ts-expect-error stopWords come from the snapshot, LoadOptions has no stopWords
  loadIndex<Book>(snapshot, { stopWords: ['the'] });
});
