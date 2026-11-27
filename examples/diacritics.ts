import { search } from 'typoseek';

const places = ['Łódź', 'Tromsø', 'São Paulo', 'Hradec Králové'];

for (const query of ['lodz', 'tromso', 'sao paolo', 'kralove']) {
  const { hits } = search(places, query);
  console.log(query, JSON.stringify(hits.map((hit) => hit.item)), JSON.stringify(hits[0]?.matches[0]?.ranges));
}
