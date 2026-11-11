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
