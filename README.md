# typoseek

Typo-tolerant full-text search for arrays of strings and records, in memory, with no runtime dependencies. It finds `barclona` when you mean `Barcelona` and returns the matched ranges for highlighting. The package imports no Node built-ins.

- Typo tolerance by edit distance, prefix and infix matching on the last query term, diacritic folding.
- Weighted keys, filters, sorting, pagination, phrases and negation.
- An index you can add to, update and remove from, and save as a snapshot that a worker loads.
- Ships ESM and CommonJS with types. Needs Node 22 or newer when run on Node.

## Install

```bash
npm install typoseek
```

The package has three entry points: `typoseek` (search and index), `typoseek/serialize` (`loadIndex`) and `typoseek/segmenter` (`createSegmenterTokenizer`).

## Quick start

One-shot search over an array. `refIndex` is the item's position in the array, `matches` holds the highlight ranges:

```ts
import { search } from 'typoseek';

const cities = ['Amsterdam', 'Barcelona', 'Copenhagen', 'Dublin'];

const { total, hits } = search(cities, 'barclona');

console.log(total);
for (const hit of hits) {
  console.log(hit.refIndex, hit.item, JSON.stringify(hit.matches));
}
```

```text
1
1 Barcelona [{"key":"","valueIndex":0,"ranges":[[0,9]]}]
```

An index for records you search repeatedly and change over time. `createIndex` needs the record type as a type argument, so a misspelled key does not compile:

```ts
import { createIndex } from 'typoseek';

interface Book {
  id: number;
  title: string;
  author: string;
}

const index = createIndex<Book>({ idKey: 'id', keys: [{ path: 'title', weight: 2 }, 'author'] });

index.addAll([
  { id: 1, title: 'The Fellowship of the Ring', author: 'J. R. R. Tolkien' },
  { id: 2, title: 'The Hobbit', author: 'J. R. R. Tolkien' },
  { id: 3, title: 'Dune', author: 'Frank Herbert' },
]);

const { total, hits } = index.search('tolkein hobit');
console.log(total, hits.map((hit) => hit.id).join(','));
console.log(JSON.stringify(hits[0]?.matches));

index.update({ id: 3, title: 'Dune Messiah', author: 'Frank Herbert' });
index.remove(1);
console.log(index.size, index.has(1), index.search('messiah').total);
```

```text
1 2
[{"key":"title","valueIndex":0,"ranges":[[4,10]]},{"key":"author","valueIndex":0,"ranges":[[9,16]]}]
2 false 1
```

`search(items, query, { keys })` also takes an array of objects. Without `keys`, every item must be a string.

## Options

### Index options

`createIndex<T>(options)` takes:

- `idKey`: the key of each record's unique id. The value must be a finite number or a non-empty string other than `__proto__`, `constructor` and `prototype`.
- `keys`: the key paths to index, each a path string or `{ path, weight }`. A path is 1 to 5 dotted segments (`author.name`), arrays are unwrapped at every level, and only string and finite number values are indexed. `weight` is a finite number above 0, default 1. A path may appear once.
- `tokenize`, `normalize`, `stem`: pipeline functions, see [Custom pipeline and stemmer](#custom-pipeline-and-stemmer). Defaults: runs of letters, digits and combining marks; `foldTerm`; no stemming.
- `stopWords`: an iterable of strings that are not indexed and not searched. Default: none.
- `limits`: `maxQueryLength`, `maxQueryTerms` and `maxExpansions`, see [Limits](#limits).

`search(items, query, options)` takes the same pipeline options, `limits` and `keys` next to the search options.

### Search options

Passed to `index.search(query, options)` and to `search(items, query, options)`:

- `mode`: `'and'` (default) needs every query term, `'or'` needs one.
- `prefix`: default `true`. The last token of the query also matches terms that start with it.
- `infix`: default `true`. The last token of the query also matches inside words, see [Query syntax](#query-syntax).
- `typos`: `false` turns typo tolerance off. Otherwise `{ minLengthForOne, minLengthForTwo }`, default `{ minLengthForOne: 4, minLengthForTwo: 8 }`. A query term of fewer than `minLengthForOne` code points matches exactly, from `minLengthForOne` it allows 1 edit, from `minLengthForTwo` it allows 2. Never more than 2 edits. The distance is optimal string alignment over code points, so two swapped adjacent letters are one edit. `minLengthForOne` is at least 1, `minLengthForTwo` is an integer not below `minLengthForOne`, or `Infinity`. Setting `minLengthForOne` above 8 alone throws `INVALID_OPTION` naming `typos.minLengthForTwo`, so set both.
- `fold`: default `true`. Compares terms with case and diacritics folded. With `false`, every clause compares the original tokens, case and diacritic sensitive after NFC normalization, and highlights mark only tokens that matched that way.
- `filter`: a predicate `(item) => boolean`, `{ key, equals }`, `{ key, range }`, or an array of them that must all hold. `equals` takes a string, number, boolean or `null`. `range` takes `gt`, `gte`, `lt` and `lte`, each a number or a `Date`.
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

### Load options

`loadIndex(data, options)` takes `tokenize`, `normalize` and `stem`, which must be the ones the index was built with, and `loadLimits`. All five `loadLimits` fields are positive integers:

- `maxRecords`: default 1,000,000.
- `maxSurfaces`: default 5,000,000.
- `maxTokens`: default 50,000,000.
- `maxStopTerms`: default 10,000.
- `maxTextLength`: default 1,000,000,000. It counts, over all records and key paths, the length of every array the load walks (holes included) plus the length of every text value in UTF-16 code units. It bounds the load whatever the input form: JSON, or a `structuredClone` result, which keeps sparse arrays and shared values. Lower it when the snapshot comes from an untrusted source.

Going over any of them throws `SERIALIZED_INDEX_TOO_LARGE`. `stopWords` and `limits` passed to `loadIndex` throw `INVALID_OPTION`, because the snapshot holds them.

## Limits

Search input is capped. An input over a cap is rejected with a typed error, never cut silently.

- `limits.maxQueryLength`: default 256 code points, range 1 to 4096. Over it throws `QUERY_TOO_LONG`.
- `limits.maxQueryTerms`: default 16 tokens, range 1 to 64. Over it throws `TOO_MANY_TERMS`.
- `truncateQuery: true` cuts the query to the first `maxQueryLength` code points and the first `maxQueryTerms` tokens instead of throwing.
- Edit distance: at most 2, see `typos` above.
- `limits.maxExpansions`: default 50, range 1 to 1000. At most this many indexed terms match one query term. Further matches are dropped without an error.
- The infix check window: per query, at most 20 times `maxExpansions` listed terms are checked for the infix match. Infix matches past the window rank after every kept one, and matches the window never reaches are dropped without an error.

Both the expansion cap and the infix window drop matches by design. Raise `maxExpansions` when an index holds many terms that share a short query term and results are missing.

## Errors

Every rejection of caller input throws a `TyposeekError` with a `code`. `isTyposeekError(value)` recognizes it across package copies, where `instanceof` fails. `recordIndex` holds the position of the failing record in a batch or in one-shot items. Messages carry option names, limits and counts, never record content, ids or query text. Exceptions thrown by your own tokenizer, normalizer, stemmer or filter predicate propagate unchanged.

- `INVALID_OPTION`: an option value is invalid, or a key, filter or sort spec is invalid, or `query` is not a string, or `records` is not an array.
- `INVALID_RECORD`: a record is not an object, or a one-shot item has the wrong kind.
- `INVALID_ID`: the id is missing, empty, not a string or finite number, or a forbidden name.
- `DUPLICATE_ID`: `add` of an id that is in the index or twice in one batch.
- `UNKNOWN_ID`: `update` or `remove` of an id that is not in the index.
- `QUERY_TOO_LONG`, `TOO_MANY_TERMS`: the query is over its cap and `truncateQuery` is not set.
- `INVALID_TOKEN_SPAN`: a tokenizer returned something other than ordered, non-empty spans inside the text.
- `INVALID_PIPELINE_OUTPUT`: a normalizer or stemmer returned a non-string.
- `INDEX_BUSY`: a mutation or `toJSON` while `addAllAsync` runs.
- `ABORTED`: the `signal` of `addAllAsync` was aborted; `cause` is `signal.reason`.
- `INVALID_SERIALIZED_INDEX`, `UNSUPPORTED_VERSION`, `SERIALIZED_INDEX_TOO_LARGE`: `loadIndex` rejected the snapshot.
- `SEGMENTER_UNAVAILABLE`: the runtime has no `Intl.Segmenter`.

A rejected call leaves the index unchanged. Batches validate every record before the first is added.

```ts
import { createIndex, isTyposeekError } from 'typoseek';

interface Tag {
  id: number;
  label: string;
}

const index = createIndex<Tag>({ idKey: 'id', keys: ['label'], limits: { maxQueryTerms: 2 } });
index.add({ id: 1, label: 'garden' });

function attempt(name: string, action: () => unknown): void {
  try {
    action();
    console.log(name, 'ok');
  } catch (error) {
    if (!isTyposeekError(error)) {
      throw error;
    }
    console.log(name, error.code, error.recordIndex ?? '-');
  }
}

attempt('duplicate id', () => {
  index.add({ id: 1, label: 'again' });
});
attempt('duplicate in batch', () => {
  index.addAll([
    { id: 2, label: 'fence' },
    { id: 2, label: 'gate' },
  ]);
});
attempt('unknown id', () => {
  index.remove(99);
});
attempt('too many terms', () => index.search('one two three'));
attempt('truncated', () => index.search('one two three', { truncateQuery: true }));
attempt('bad option', () => index.search('garden', { limit: -1 }));
attempt('bad record', () => {
  index.add(null as unknown as Tag);
});
```

```text
duplicate id DUPLICATE_ID 0
duplicate in batch DUPLICATE_ID 1
unknown id UNKNOWN_ID -
too many terms TOO_MANY_TERMS -
truncated ok
bad option INVALID_OPTION -
bad record INVALID_RECORD 0
```

`addAllAsync(records, { signal })` indexes in slices and yields between them, so a page stays responsive. While it runs, `add`, `addAll`, `update`, `remove` and `toJSON` throw `INDEX_BUSY`. An aborted run rolls back, so the index holds what it held before.

## Query syntax

- Words are tokenized like the records. All must match in `'and'` mode, one in `'or'` mode.
- `"exact phrase"` matches the terms adjacent and in order within one value. Stop words inside a phrase match any token at their position.
- `-term` and `-"exact phrase"` exclude records that hold that exact term or phrase.
- The last token of the query matches by prefix when `prefix` is on and inside words when `infix` is on, with the conditions below.
- A query with no clauses left (empty, whitespace, only stop words) returns every record in original order, then filter, sort and pagination apply.

Prefix and infix apply to the last token of the query as the tokenizer reads it, stop words included. A query that ends in a stop word, such as `cat the` with `the` a stop word, gets no prefix or infix clause for any term. A query that ends in a negated term or a phrase gets neither either.

Infix has these conditions:

- The last token must be a positive term of at least 3 code points.
- It matches, without typos, every indexed term that contains it after the term's first code point (`amp` finds `lamp`).
- It ranks below exact and prefix matches and above every match with a typo.
- Terms longer than 64 code points (counted on the folded term) have no infix entries, so infix does not find them. Exact, prefix and typo matching still reach them.

## Ranking

Hits are ordered by these keys, each used only to break a tie in the keys before it:

1. More matched query clauses first.
2. Lower typo cost first. A typo in the first letter counts 2.
3. Fewer infix matches first.
4. Fewer prefix matches first.
5. Higher BM25 style score first. A key's `weight` multiplies the term frequency of that key before saturation, so with equal field lengths relative to the key's average, a match in a weight 2 key ranks above the same match in a weight 1 key.
6. Original order: the order of first `add`. `update` keeps the position, `remove` then `add` moves the record to the end.

`sortBy` replaces all of these except the original order for ties.

`hit.matches` lists, per key path and value, the highlight `ranges`: whole-token `[start, end)` UTF-16 offsets into the original value. `key` is the path as given in `keys` (an empty string for one-shot string items) and `valueIndex` is the position among the values that path resolves to, nested arrays flattened depth first. A number is searched and highlighted as `String(value)`.

Terms are folded with `foldTerm`: ASCII lowercases directly, other text is decomposed (NFKD), combining marks are removed, the result is decomposed again (removing U+034F leaves marks out of canonical order, so a second NFKD pass restores them), lowercased, and then `ß`, `æ`, `œ`, `ø`, `đ`, `ł`, `ı`, `ς`, `þ`, typographic quotes and dashes are mapped to their plain forms.

## Indexed records

The index holds your record objects by reference. Do not change an indexed record until you pass it to `update` (the same object is accepted) or remove it. Highlighting a changed record throws, and a snapshot written after such a change fails `loadIndex`.

## Serialization and workers

`index.toJSON()` returns a snapshot with the records, the token streams, the stop terms and the limits. The snapshot holds the records by reference and writes them as they are, so they must survive `JSON.stringify` (a `Date` becomes a string) or the structured clone that `postMessage` uses.

```ts
import { createIndex, type Normalizer } from 'typoseek';
import { loadIndex } from 'typoseek/serialize';

interface Note {
  id: number;
  text: string;
}

const normalizeToLowerCase: Normalizer = (term) => term.toLowerCase();

const index = createIndex<Note>({
  idKey: 'id',
  keys: ['text'],
  normalize: normalizeToLowerCase,
  stopWords: ['the'],
  limits: { maxQueryTerms: 4 },
});

index.addAll([
  { id: 1, text: 'Water the plants' },
  { id: 2, text: 'Book the dentist' },
]);

const json = JSON.stringify(index.toJSON());

const restored = loadIndex<Note>(JSON.parse(json), {
  normalize: normalizeToLowerCase,
  loadLimits: { maxTextLength: 1_000_000 },
});

const snapshot = restored.toJSON();
const dentistHits = restored.search('dentist').hits;
console.log(restored.size, dentistHits.map((hit) => hit.id).join(','));
console.log(snapshot.stopTerms.join(','), snapshot.limits.maxQueryTerms);
console.log(restored.search('the').total);
```

```text
2 2
the 4
2
```

`loadIndex` needs the tokenizer, normalizer and stemmer the index was built with, because functions are not serialized. A different tokenizer is detected when the stored streams no longer match the record text. A different normalizer or stemmer is not detected, and searches then return wrong results without an error. Stop words and limits travel in the snapshot, so you do not pass them.

`loadIndex` validates structure, ids, key paths, query limits, stop terms and every stream against its record's text, and rejects with `INVALID_SERIALIZED_INDEX`, `UNSUPPORTED_VERSION` or `SERIALIZED_INDEX_TOO_LARGE`. Stored terms are taken as they are, so load snapshots you wrote, or lower `loadLimits` for anything else.

Residual cost for untrusted input: `filter` and `sortBy` may name keys outside `keys`, which `loadIndex` never walks. A snapshot that came through `structuredClone` can hold a huge sparse array there, and that costs time on each query that filters or sorts by it. Round trip an untrusted cloned snapshot through `JSON.parse(JSON.stringify(snapshot))` before `loadIndex`.

### Worker recipe

Build on the main thread, send the snapshot, load it in the worker. The example runs both halves in one process: the snapshot goes through a `MessageChannel`, whose structured clone is what `postMessage` to a worker uses, and through `JSON.stringify`. The `startWorker` function is the half that belongs in the worker file; the rest runs on the main thread.

```ts
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { createIndex, type SearchIndex } from 'typoseek';
import { loadIndex, type SerializedIndex } from 'typoseek/serialize';

interface Note {
  id: number;
  text: string;
}

type Request = { type: 'load'; snapshot: SerializedIndex<Note> } | { type: 'search'; query: string };

type Response = { type: 'loaded'; size: number } | { type: 'found'; ids: number[] };

function startWorker(port: MessagePort): void {
  let index: SearchIndex<Note> | undefined;
  port.on('message', (request: Request) => {
    if (request.type === 'load') {
      index = loadIndex<Note>(request.snapshot);
      port.postMessage({ type: 'loaded', size: index.size } satisfies Response);
    } else if (index !== undefined) {
      const ids = index.search(request.query).hits.map((hit) => hit.item.id);
      port.postMessage({ type: 'found', ids } satisfies Response);
    }
  });
}

function ask(port: MessagePort, request: Request): Promise<Response> {
  return new Promise((resolve) => {
    port.once('message', (response: Response) => {
      resolve(response);
    });
    port.postMessage(request);
  });
}

const index = createIndex<Note>({ idKey: 'id', keys: ['text'] });
index.addAll([
  { id: 1, text: 'Water the plants' },
  { id: 2, text: 'Book the dentist' },
]);

const { port1: mainPort, port2: workerPort } = new MessageChannel();
startWorker(workerPort);

console.log(JSON.stringify(await ask(mainPort, { type: 'load', snapshot: index.toJSON() })));
console.log(JSON.stringify(await ask(mainPort, { type: 'search', query: 'dentst' })));
mainPort.close();
workerPort.close();

const fromJson = loadIndex<Note>(JSON.parse(JSON.stringify(index.toJSON())));
const plantHits = fromJson.search('plants').hits;
console.log(plantHits.map((hit) => hit.id).join(','));
```

```text
{"type":"loaded","size":2}
{"type":"found","ids":[2]}
1
```

## Segmenter

The default tokenizer splits on anything that is not a letter, digit or combining mark, which does not separate words in languages written without spaces. `createSegmenterTokenizer(locales)` from `typoseek/segmenter` tokenizes with `Intl.Segmenter` and keeps the word-like segments. It throws `SEGMENTER_UNAVAILABLE` in a runtime without `Intl.Segmenter`. Pass the same tokenizer to `loadIndex`.

```ts
import { createIndex } from 'typoseek';
import { createSegmenterTokenizer } from 'typoseek/segmenter';

interface Sentence {
  id: number;
  text: string;
}

const tokenize = createSegmenterTokenizer('ja');

const index = createIndex<Sentence>({ idKey: 'id', keys: ['text'], tokenize });

index.addAll([
  { id: 1, text: '私は東京に住んでいます' },
  { id: 2, text: '大阪で寿司を食べました' },
]);

const { hits } = index.search('東京');
console.log(hits.map((hit) => hit.id).join(','), JSON.stringify(hits[0]?.matches));
console.log(index.search('京').total);
```

```text
1 [{"key":"text","valueIndex":0,"ranges":[[2,4]]}]
0
```

## Custom pipeline and stemmer

Each token goes through `tokenize`, then `normalize` (default `foldTerm`), then the stop word check on the normalized term, then `stem`. A tokenizer returns ordered, non-empty `{ start, end }` spans inside the text; a normalizer or stemmer returns a string. A term that becomes empty is dropped. Stop words are normalized with your `normalize` before the comparison.

The example below replaces all three functions. Its normalizer only lowercases, so diacritics are no longer folded:

```ts
import { createIndex, type Normalizer, type Stemmer, type Tokenizer } from 'typoseek';

interface Article {
  id: number;
  headline: string;
}

const tokenizeOnWhitespace: Tokenizer = (text) =>
  Array.from(text.matchAll(/\S+/g), (match) => ({ start: match.index, end: match.index + match[0].length }));

const normalizeToLowerCase: Normalizer = (term) => term.toLowerCase();

const stemPlural: Stemmer = (term) => (term.length > 3 && term.endsWith('s') ? term.slice(0, -1) : term);

const index = createIndex<Article>({
  idKey: 'id',
  keys: ['headline'],
  tokenize: tokenizeOnWhitespace,
  normalize: normalizeToLowerCase,
  stem: stemPlural,
  stopWords: ['the', 'of'],
});

index.addAll([
  { id: 1, headline: 'The Rise of Electric Bikes' },
  { id: 2, headline: 'Bikes and Buses: a City Guide' },
  { id: 3, headline: 'Café Culture' },
]);

const stemmedHits = index.search('bike').hits;
console.log('stemmed', stemmedHits.map((hit) => hit.id).join(','));
console.log('stop words only', index.search('the of').total);
console.log('folding is off', index.search('cafe', { typos: false }).total, index.search('café').total);
console.log('whitespace tokens', JSON.stringify(index.search('guide').hits[0]?.matches));
```

```text
stemmed 1,2
stop words only 3
folding is off 0 1
whitespace tokens [{"key":"headline","valueIndex":0,"ranges":[[24,29]]}]
```

A tokenizer, normalizer or stemmer must be pure: the same input gives the same output. A tokenizer that changes between indexing and highlighting makes highlighting throw.

## Migration

Each example runs the same query through the old library and through typoseek.

### From Fuse

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

### From MiniSearch

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

### From match-sorter

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

## Performance

Numbers from one run of `npm run bench` on 2026-11-11: Apple M4 Pro, 14 logical cores, 48 GiB, macOS (Darwin 27.3.0, arm64), Node v24.20.0. The dataset is 10,000 and 100,000 generated records with a title, a body and a tag, and 200 queries of 2 or 3 words, some with edits. They say nothing about other machines. The competitors are MiniSearch 7.2.0, Fuse 7.5.0, Orama 3.1.18, FlexSearch 0.8.212, fuzzysort 4.0.2 and uFuzzy 1.0.19; the median is over these six.

| Records | Measure            | typoseek | Competitor median |
| ------- | ------------------ | -------- | ----------------- |
| 10,000  | Search p95 (ms)    | 8.41     | 6.00              |
| 10,000  | Build time (ms)    | 135      | 51                |
| 10,000  | Retained heap (MB) | 28.2     | 17.4              |
| 100,000 | Search p95 (ms)    | 29.65    | 65.23             |
| 100,000 | Build time (ms)    | 867      | 726               |
| 100,000 | Retained heap (MB) | 118.5    | 116.0             |

Retained heap at 100,000 records is 2.56 MB (2.2%) above the competitor median, so typoseek does not reach its target of staying below it. It also keeps 1.13 MB in array buffers that `heapUsed` does not count.

The libraries do not return the same matches: at both sizes typoseek returned results for 186 of the 200 queries and the other libraries for 48 to 189. [BENCHMARK.md](BENCHMARK.md) has p50, every library, the settings each ran with and how to rerun it. While `addAllAsync` indexed 100,000 records, the longest gap between event loop callbacks was 31.6 ms in a preparation slice, 49.9 ms in a commit slice and 32.7 ms in a rollback slice on that machine.

## API reference

Every export, by entry point.

### `typoseek`

- `createIndex`: creates a `SearchIndex<T>`; takes `IndexOptions<T>`.
- `search`: one-shot search over `string` items or objects with `keys`; returns `SearchResponse<ArrayHit<T>>`.
- `tokenize`: the default tokenizer, returns `TokenSpan[]`.
- `foldTerm`: the default normalizer.
- `TyposeekError`: the error class, with `code` and `recordIndex`.
- `isTyposeekError`: type guard for `TyposeekError`.
- `ErrorCode`: the union of error codes in [Errors](#errors).
- `SearchIndex`: `size`, `has`, `add`, `addAll`, `addAllAsync`, `update`, `remove`, `search`, `toJSON`.
- `SearchOptions`, `Filter`, `RangeBounds`, `SortBy`, `TypoTolerance`: search options.
- `IndexOptions`, `KeySpec`, `IdKey`, `KeyPath`, `TextPath`, `ValuePath`, `Limits`: index options and key path types.
- `StringSearchOptions`, `ObjectSearchOptions`: options of `search`.
- `PipelineOptions`, `PipelineFunctions`, `Tokenizer`, `Normalizer`, `Stemmer`, `TokenSpan`: pipeline types.
- `SearchResponse`, `IndexHit`, `ArrayHit`, `FieldMatch`, `Range`, `Id`: result types.
- `AsyncAddOptions`, `AbortSignalLike`: options of `addAllAsync`; any `AbortSignal` fits `AbortSignalLike`.
- `SerializedIndex`: the snapshot type.

### `typoseek/serialize`

- `loadIndex`: restores a `SearchIndex<T>` from a snapshot; `loadIndex<Book>(data)` gives `SearchIndex<Book>`, without a type argument it gives `SearchIndex<object>`.
- `LoadOptions`, `LoadLimits`: its options.
- Types re-exported from `typoseek`: `AbortSignalLike`, `AsyncAddOptions`, `FieldMatch`, `Filter`, `Id`, `IndexHit`, `KeyPath`, `Limits`, `Normalizer`, `PipelineFunctions`, `Range`, `RangeBounds`, `SearchIndex`, `SearchOptions`, `SearchResponse`, `SerializedIndex`, `SortBy`, `Stemmer`, `TokenSpan`, `Tokenizer`, `TypoTolerance`, `ValuePath`.

### `typoseek/segmenter`

- `createSegmenterTokenizer`: a `Tokenizer` over `Intl.Segmenter` word segments.
- `TokenSpan`, `Tokenizer`: re-exported types.
