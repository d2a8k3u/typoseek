import { createIndex } from 'typoseek';

const index = createIndex({ idKey: 'id', keys: ['title'] });
index.addAll([
  { id: 1, title: 'Search engine' },
  { id: 2, title: 'Garden tools' },
]);

console.log(JSON.stringify(index.search('serch').hits.map((hit) => hit.id)));
