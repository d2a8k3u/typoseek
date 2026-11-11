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
