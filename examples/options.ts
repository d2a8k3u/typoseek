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
