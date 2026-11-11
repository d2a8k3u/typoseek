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
