# Segmenter and custom pipeline

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
