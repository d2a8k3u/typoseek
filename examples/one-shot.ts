import { search } from 'typoseek';

const cities = ['Amsterdam', 'Barcelona', 'Copenhagen', 'Dublin'];

const { total, hits } = search(cities, 'barclona');

console.log(total);
for (const hit of hits) {
  console.log(hit.refIndex, hit.item, JSON.stringify(hit.matches));
}
