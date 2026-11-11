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
