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
