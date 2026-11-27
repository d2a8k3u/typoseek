# Migration

Each example runs the same query through the old library and through typoseek.

## From Fuse

Fuse `keys` become `keys`, and a Fuse key `weight` becomes `{ path, weight }`. Fuse `limit` becomes the `limit` option. typoseek has no `threshold`: typo tolerance follows term length, see `typos`. Fuse `includeMatches` reports inclusive `indices`, typoseek `ranges` end exclusive, as the output shows.

```ts
import Fuse from 'fuse.js';
import { createIndex } from 'typoseek';

interface Book {
  id: number;
  title: string;
  author: string;
}

const books: Book[] = [
  { id: 1, title: 'The Fellowship of the Ring', author: 'J. R. R. Tolkien' },
  { id: 2, title: 'The Hobbit', author: 'J. R. R. Tolkien' },
  { id: 3, title: 'Dune', author: 'Frank Herbert' },
];

const fuse = new Fuse(books, {
  keys: [{ name: 'title', weight: 2 }, 'author'],
  includeMatches: true,
  threshold: 0.3,
});
const fuseResults = fuse.search('hobit', { limit: 5 });
console.log('fuse', fuseResults.map((result) => result.item.id).join(','));
console.log('fuse indices', JSON.stringify(fuseResults[0]?.matches?.[0]?.indices));

const index = createIndex<Book>({ idKey: 'id', keys: [{ path: 'title', weight: 2 }, 'author'] });
index.addAll(books);
const { hits } = index.search('hobit', { limit: 5 });
console.log('typoseek', hits.map((hit) => hit.id).join(','));
console.log('typoseek ranges', JSON.stringify(hits[0]?.matches[0]?.ranges));
```

```text
fuse 2
fuse indices [[4,9]]
typoseek 2
typoseek ranges [[4,10]]
```

## From MiniSearch

MiniSearch `fields` become `keys`, `searchOptions.boost` becomes the key `weight`, and its `idField` becomes `idKey`. `combineWith: 'AND'` is the default `mode`, `prefix: true` is the default `prefix` (on the last term), and `discard` is `remove`. MiniSearch measures Levenshtein distance and typoseek optimal string alignment, so a swapped pair of letters (`tolkein`) is one edit in typoseek and two in MiniSearch.

```ts
import MiniSearch from 'minisearch';
import { createIndex } from 'typoseek';

interface Book {
  id: number;
  title: string;
  author: string;
}

const books: Book[] = [
  { id: 1, title: 'The Fellowship of the Ring', author: 'J. R. R. Tolkien' },
  { id: 2, title: 'The Hobbit', author: 'J. R. R. Tolkien' },
  { id: 3, title: 'Dune', author: 'Frank Herbert' },
];

const miniSearch = new MiniSearch<Book>({
  fields: ['title', 'author'],
  storeFields: ['title'],
  searchOptions: { boost: { title: 2 }, prefix: true, fuzzy: 0.2, combineWith: 'AND' },
});
miniSearch.addAll(books);

const index = createIndex<Book>({ idKey: 'id', keys: [{ path: 'title', weight: 2 }, 'author'] });
index.addAll(books);

for (const query of ['tolkien hobbit', 'tolkein hobbit']) {
  const miniSearchCount = miniSearch.search(query).length;
  const typoseekCount = index.search(query).total;
  console.log(query, 'minisearch', miniSearchCount, 'typoseek', typoseekCount);
}

miniSearch.discard(2);
index.remove(2);
console.log(miniSearch.search('hobbit').length, index.search('hobbit').total);
```

```text
tolkien hobbit minisearch 1 typoseek 1
tolkein hobbit minisearch 0 typoseek 1
0 0
```

## From match-sorter

`matchSorter(items, query, { keys })` becomes `search(items, query, { keys })`. The result is `{ total, hits }` with `hit.item` and `hit.refIndex`, not an array of items. typoseek tolerates typos but does not match a subsequence of letters, so a query like `hbt` finds nothing.

```ts
import { matchSorter } from 'match-sorter';
import { search } from 'typoseek';

interface Book {
  title: string;
  author: string;
}

const books: Book[] = [
  { title: 'The Fellowship of the Ring', author: 'J. R. R. Tolkien' },
  { title: 'The Hobbit', author: 'J. R. R. Tolkien' },
  { title: 'Dune', author: 'Frank Herbert' },
];

const sorted = matchSorter(books, 'hobbit', { keys: ['title', 'author'] });
console.log('match-sorter', sorted.map((book) => book.title).join(','));

const { hits } = search(books, 'hobbit', { keys: ['title', 'author'] });
console.log('typoseek', hits.map((hit) => hit.item.title).join(','));
console.log('typoseek refIndex', hits.map((hit) => hit.refIndex).join(','));

console.log('match-sorter subsequence', matchSorter(books, 'hbt', { keys: ['title'] }).length);
console.log('typoseek subsequence', search(books, 'hbt', { keys: ['title'] }).total);
```

```text
match-sorter The Hobbit
typoseek The Hobbit
typoseek refIndex 1
match-sorter subsequence 1
typoseek subsequence 0
```
