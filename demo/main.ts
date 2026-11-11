import { createIndex, type IndexHit, type Range } from 'typoseek';
import { books, type Book } from './data';

const PAGE_SIZE = 10;

const index = createIndex<Book>({ idKey: 'id', keys: [{ path: 'title', weight: 2 }, 'author'] });
index.addAll(books);

function required<E extends Element>(element: E | null, selector: string): E {
  if (element === null) {
    throw new Error(`Missing element ${selector}`);
  }
  return element;
}

const queryInput = required(document.querySelector<HTMLInputElement>('#query'), '#query');
const status = required(document.querySelector<HTMLElement>('#status'), '#status');
const results = required(document.querySelector<HTMLUListElement>('#results'), '#results');

function rangesOf(hit: IndexHit<Book>, key: keyof Book): Range[] {
  return hit.matches
    .filter((match) => match.key === key)
    .flatMap((match) => [...match.ranges])
    .sort(([firstStart], [secondStart]) => firstStart - secondStart);
}

function highlighted(text: string, ranges: readonly Range[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const [start, end] of ranges) {
    fragment.append(text.slice(cursor, start));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(start, end);
    fragment.append(mark);
    cursor = end;
  }
  fragment.append(text.slice(cursor));
  return fragment;
}

function resultItem(hit: IndexHit<Book>): HTMLLIElement {
  const title = document.createElement('span');
  title.className = 'title';
  title.append(highlighted(hit.item.title, rangesOf(hit, 'title')));
  const author = document.createElement('span');
  author.className = 'author';
  author.append(highlighted(hit.item.author, rangesOf(hit, 'author')));
  const item = document.createElement('li');
  item.append(title, ' ', author);
  return item;
}

function statusText(total: number, shown: number): string {
  const noun = total === 1 ? 'result' : 'results';
  return shown < total ? `${String(total)} ${noun}, showing the first ${String(shown)}` : `${String(total)} ${noun}`;
}

function render(): void {
  const { total, hits } = index.search(queryInput.value, { limit: PAGE_SIZE });
  results.replaceChildren(...hits.map(resultItem));
  status.textContent = statusText(total, hits.length);
}

queryInput.addEventListener('input', render);
render();
