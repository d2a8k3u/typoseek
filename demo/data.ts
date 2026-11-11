export interface Book {
  id: number;
  title: string;
  author: string;
}

export const books: readonly Book[] = [
  { id: 1, title: 'The Hobbit', author: 'J. R. R. Tolkien' },
  { id: 2, title: 'The Fellowship of the Ring', author: 'J. R. R. Tolkien' },
  { id: 3, title: 'Dune', author: 'Frank Herbert' },
  { id: 4, title: 'Neuromancer', author: 'William Gibson' },
  { id: 5, title: 'Pride and Prejudice', author: 'Jane Austen' },
  { id: 6, title: 'Emma', author: 'Jane Austen' },
  { id: 7, title: 'Frankenstein', author: 'Mary Shelley' },
  { id: 8, title: 'Dracula', author: 'Bram Stoker' },
  { id: 9, title: 'Brave New World', author: 'Aldous Huxley' },
  { id: 10, title: 'Nineteen Eighty-Four', author: 'George Orwell' },
  { id: 11, title: 'Animal Farm', author: 'George Orwell' },
  { id: 12, title: 'The Great Gatsby', author: 'F. Scott Fitzgerald' },
  { id: 13, title: 'Moby-Dick', author: 'Herman Melville' },
  { id: 14, title: 'Wuthering Heights', author: 'Emily Brontë' },
  { id: 15, title: 'Jane Eyre', author: 'Charlotte Brontë' },
  { id: 16, title: 'The Left Hand of Darkness', author: 'Ursula K. Le Guin' },
  { id: 17, title: 'A Wizard of Earthsea', author: 'Ursula K. Le Guin' },
  { id: 18, title: 'Solaris', author: 'Stanisław Lem' },
  { id: 19, title: 'The Good Soldier Švejk', author: 'Jaroslav Hašek' },
  { id: 20, title: 'The Trial', author: 'Franz Kafka' },
  { id: 21, title: 'The Metamorphosis', author: 'Franz Kafka' },
  { id: 22, title: 'The Master and Margarita', author: 'Mikhail Bulgakov' },
  { id: 23, title: 'One Hundred Years of Solitude', author: 'Gabriel García Márquez' },
  { id: 24, title: 'Foundation', author: 'Isaac Asimov' },
];
