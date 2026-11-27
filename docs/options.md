# Options

## Index options

`createIndex<T>(options)` takes:

- `idKey`: the key of each record's unique id. The value must be a finite number or a non-empty string other than `__proto__`, `constructor` and `prototype`.
- `keys`: the key paths to index, each a path string or `{ path, weight }`. A path is 1 to 5 dotted segments (`author.name`), arrays are unwrapped at every level, and only string and finite number values are indexed. `weight` is a finite number above 0, default 1. A path may appear once.
- `tokenize`, `normalize`, `stem`: pipeline functions, see [Custom pipeline and stemmer](pipeline.md#custom-pipeline-and-stemmer). Defaults: runs of letters, digits and combining marks; `foldTerm`; no stemming.
- `stopWords`: an iterable of strings that are not indexed and not searched. Default: none.
- `limits`: `maxQueryLength`, `maxQueryTerms` and `maxExpansions`, see [Limits](#limits).

`search(items, query, options)` takes the same pipeline options, `limits` and `keys` next to the search options.

## Search options

Passed to `index.search(query, options)` and to `search(items, query, options)`:

- `mode`: `'and'` (default) needs every query term, `'or'` needs one.
- `prefix`: default `true`. The last token of the query also matches terms that start with it.
- `infix`: default `true`. The last token of the query also matches inside words, see [Query syntax](query-and-ranking.md#query-syntax).
- `typos`: `false` turns typo tolerance off. Otherwise `{ minLengthForOne, minLengthForTwo }`, default `{ minLengthForOne: 4, minLengthForTwo: 8 }`. A query term of fewer than `minLengthForOne` code points matches exactly, from `minLengthForOne` it allows 1 edit, from `minLengthForTwo` it allows 2. Never more than 2 edits. The distance is optimal string alignment over code points, so two swapped adjacent letters are one edit. `minLengthForOne` is at least 1, `minLengthForTwo` is an integer not below `minLengthForOne`, or `Infinity`. Setting `minLengthForOne` above 8 alone throws `INVALID_OPTION` naming `typos.minLengthForTwo`, so set both.
- `fold`: default `true`. Compares terms with case and diacritics folded. With `false`, every clause compares the original tokens, case and diacritic sensitive after NFC normalization, and highlights mark only tokens that matched that way.
- `filter`: a predicate `(item) => boolean`, `{ key, equals }`, `{ key, range }`, or an array of them that must all hold. `equals` takes a string, a finite number, a boolean or `null`. `range` takes `gt`, `gte`, `lt` and `lte`, each a finite number or a valid `Date`.
- `sortBy`: `{ key, direction }` with `direction` `'asc'` (default) or `'desc'`. Replaces relevance order; ties keep the original order.
- `limit`: default 20, an integer from 0 to 1000. `offset`: default 0. `total` counts every match after filters, the page is the positions from `offset` to `offset + limit`.
- `truncateQuery`: default `false`, see [Limits](#limits).

String items take predicate filters only and no `sortBy`; anything else throws `INVALID_OPTION`. `filter` and `sortBy` keys may name fields that are not in `keys`.

This example runs each option on four products:

```ts
import { createIndex, type SearchOptions } from 'typoseek';

interface Product {
  id: string;
  name: string;
  description: string;
}

const index = createIndex<Product>({
  idKey: 'id',
  keys: ['name', { path: 'description', weight: 0.5 }],
  stopWords: ['a', 'for', 'with'],
  limits: { maxQueryLength: 64, maxQueryTerms: 8, maxExpansions: 25 },
});

index.addAll([
  { id: 'p1', name: 'Desk lamp', description: 'Adjustable lamp for a desk' },
  { id: 'p2', name: 'Standing desk', description: 'Height adjustable desk with a bamboo top' },
  { id: 'p3', name: 'Café table', description: 'Small table for a café or a balcony' },
  { id: 'p4', name: 'Floor lamp', description: 'Tall lamp with a linen shade' },
]);

const variants: [string, string, SearchOptions<Product>][] = [
  ['defaults', 'lamp desk', {}],
  ['mode or', 'lamp desk', { mode: 'or' }],
  ['prefix', 'des', {}],
  ['prefix off', 'des', { prefix: false }],
  ['infix', 'amp', {}],
  ['infix off', 'amp', { infix: false }],
  ['typo', 'lmap', {}],
  ['typos off', 'lmap', { typos: false }],
  ['fold', 'cafe', {}],
  ['fold off', 'cafe', { fold: false }],
  ['page', 'lamp', { limit: 1, offset: 1 }],
  ['truncated', 'lamp desk table floor standing small tall adjustable bamboo', { mode: 'or', truncateQuery: true }],
];

for (const [name, query, options] of variants) {
  const { total, hits } = index.search(query, options);
  console.log(name, total, hits.map((hit) => hit.id).join(',') || '-');
}
```

```text
defaults 1 p1
mode or 3 p1,p4,p2
prefix 2 p1,p2
prefix off 0 -
infix 2 p1,p4
infix off 0 -
typo 2 p1,p4
typos off 0 -
fold 1 p3
fold off 0 -
page 2 p4
truncated 4 p4,p2,p1,p3
```

Filters and sorting:

```ts
import { createIndex } from 'typoseek';

interface Product {
  id: number;
  name: string;
  price: number;
  inStock: boolean;
  added: Date;
  tags: string[];
}

const index = createIndex<Product>({ idKey: 'id', keys: ['name'] });

index.addAll([
  { id: 1, name: 'Desk lamp', price: 45, inStock: true, added: new Date('2026-03-01'), tags: ['home', 'office'] },
  { id: 2, name: 'Floor lamp', price: 120, inStock: false, added: new Date('2026-06-15'), tags: ['home'] },
  { id: 3, name: 'Clip lamp', price: 15, inStock: true, added: new Date('2026-09-30'), tags: ['office'] },
  { id: 4, name: 'Lamp shade', price: 25, inStock: true, added: new Date('2025-12-24'), tags: ['home'] },
]);

const ids = (hits: readonly { id: number | string }[]): string => hits.map((hit) => hit.id).join(',');

console.log('in stock', ids(index.search('lamp', { filter: { key: 'inStock', equals: true } }).hits));
console.log('price range', ids(index.search('lamp', { filter: { key: 'price', range: { gte: 20, lt: 100 } } }).hits));
const addedThisYear = { key: 'added', range: { gt: new Date('2026-01-01') } } as const;
console.log('added since', ids(index.search('lamp', { filter: addedThisYear }).hits));
console.log('predicate', ids(index.search('lamp', { filter: (product) => product.tags.includes('office') }).hits));

const inStockUnder100 = [
  { key: 'inStock', equals: true },
  { key: 'price', range: { lt: 100 } },
] as const;
console.log('all filters', ids(index.search('lamp', { filter: inStockUnder100 }).hits));

console.log('cheapest first', ids(index.search('lamp', { sortBy: { key: 'price' } }).hits));
console.log('dearest first', ids(index.search('lamp', { sortBy: { key: 'price', direction: 'desc' } }).hits));
console.log('empty query', ids(index.search('', { sortBy: { key: 'added', direction: 'desc' }, limit: 2 }).hits));
```

```text
in stock 1,3,4
price range 1,4
added since 1,2,3
predicate 1,3
all filters 1,3,4
cheapest first 3,4,1,2
dearest first 2,1,4,3
empty query 3,2
```

## Load options

`loadIndex(data, options)` takes `tokenize`, `normalize` and `stem`, which must be the ones the index was built with, and `loadLimits`. All five `loadLimits` fields are positive integers:

- `maxRecords`: default 1,000,000.
- `maxSurfaces`: default 5,000,000.
- `maxTokens`: default 50,000,000.
- `maxStopTerms`: default 10,000.
- `maxTextLength`: default 1,000,000,000. It counts, over all records and key paths, the length of every array the load walks (holes included) plus the length of every text value in UTF-16 code units. It bounds the load whatever the input form: JSON, or a `structuredClone` result, which keeps sparse arrays and shared values. Lower it when the snapshot comes from an untrusted source.

Going over any of them throws `SERIALIZED_INDEX_TOO_LARGE`. `stopWords` and `limits` passed to `loadIndex` throw `INVALID_OPTION`, because the snapshot holds them.

## Limits

Search input is capped. A query over a cap is rejected with a typed error unless `truncateQuery` is set.

- `limits.maxQueryLength`: default 256 code points, range 1 to 4096. Over it throws `QUERY_TOO_LONG`.
- `limits.maxQueryTerms`: default 16 tokens, range 1 to 64. Over it throws `TOO_MANY_TERMS`.
- `truncateQuery: true` cuts the query to the first `maxQueryLength` code points and the first `maxQueryTerms` tokens instead of throwing.
- Edit distance: at most 2, see `typos` above.
- `limits.maxExpansions`: default 50, range 1 to 1000. At most this many indexed terms match one query term. Further matches are dropped without an error.
- The infix check window: per query, at most 20 times `maxExpansions` listed terms are checked for the infix match. Infix matches past the window rank after every kept one, and matches the window never reaches are dropped without an error.

Both the expansion cap and the infix window drop matches by design. Raise `maxExpansions` when an index holds many terms that share a short query term and results are missing.
