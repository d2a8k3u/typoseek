import { createIndex, type Normalizer } from 'typoseek';
import { loadIndex } from 'typoseek/serialize';

interface Note {
  id: number;
  text: string;
}

const normalizeToLowerCase: Normalizer = (term) => term.toLowerCase();

const index = createIndex<Note>({
  idKey: 'id',
  keys: ['text'],
  normalize: normalizeToLowerCase,
  stopWords: ['the'],
  limits: { maxQueryTerms: 4 },
});

index.addAll([
  { id: 1, text: 'Water the plants' },
  { id: 2, text: 'Book the dentist' },
]);

const json = JSON.stringify(index.toJSON());

const restored = loadIndex<Note>(JSON.parse(json), {
  normalize: normalizeToLowerCase,
  loadLimits: { maxTextLength: 1_000_000 },
});

const snapshot = restored.toJSON();
const dentistHits = restored.search('dentist').hits;
console.log(restored.size, dentistHits.map((hit) => hit.id).join(','));
console.log(snapshot.stopTerms.join(','), snapshot.limits.maxQueryTerms);
console.log(restored.search('the').total);
