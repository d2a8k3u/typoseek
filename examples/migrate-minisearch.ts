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
