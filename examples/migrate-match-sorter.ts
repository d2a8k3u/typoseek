import { matchSorter } from 'match-sorter';
import { search } from 'typoseek';

interface Book {
  title: string;
  author: string;
}

const books: Book[] = [
  { title: 'The Fellowship of the Ring', author: 'J. R. R. Tolkien' },
  { title: 'The Hobbit', author: 'J. R. R. Tolkien' },
  { title: 'Dune', author: 'Frank Herbert' },
];

const sorted = matchSorter(books, 'hobbit', { keys: ['title', 'author'] });
console.log('match-sorter', sorted.map((book) => book.title).join(','));

const { hits } = search(books, 'hobbit', { keys: ['title', 'author'] });
console.log('typoseek', hits.map((hit) => hit.item.title).join(','));
console.log('typoseek refIndex', hits.map((hit) => hit.refIndex).join(','));

console.log('match-sorter subsequence', matchSorter(books, 'hbt', { keys: ['title'] }).length);
console.log('typoseek subsequence', search(books, 'hbt', { keys: ['title'] }).total);
