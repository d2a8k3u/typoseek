import { createIndex, type IndexHit, type SearchResponse } from 'typoseek';
import { createSegmenterTokenizer } from 'typoseek/segmenter';
import { loadIndex } from 'typoseek/serialize';

interface Article {
  readonly id: number;
  readonly title: string;
}

const tokenize = createSegmenterTokenizer('ja');
const index = createIndex<Article>({ idKey: 'id', keys: ['title'], tokenize });
index.add({ id: 1, title: '全文検索エンジン' });
const restored = loadIndex<Article>(JSON.parse(JSON.stringify(index.toJSON())), { tokenize });
const response: SearchResponse<IndexHit<Article>> = restored.search('検索');

export const titles: readonly string[] = response.hits.map((hit) => hit.item.title);
