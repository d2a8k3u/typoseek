# Indexed records and serialization

## Indexed records

The index holds your record objects by reference. Do not change an indexed record until you pass it to `update` (the same object is accepted) or remove it. Highlighting a changed record throws, and a snapshot written after such a change fails `loadIndex`.

## Serialization and workers

`index.toJSON()` returns a snapshot with the records, the token streams, the stop terms and the limits. The snapshot holds the records by reference and writes them as they are, so they must survive `JSON.stringify` (a `Date` becomes a string) or the structured clone that `postMessage` uses.

```ts
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
```

```text
2 2
the 4
2
```

`loadIndex` needs the tokenizer, normalizer and stemmer the index was built with, because functions are not serialized. A different tokenizer is detected when the stored streams no longer match the record text. A different normalizer or stemmer is not detected, and searches then return wrong results without an error. Stop words and limits travel in the snapshot, so you do not pass them.

`loadIndex` validates structure, ids, key paths, query limits, stop terms and every stream against its record's text, and rejects with `INVALID_SERIALIZED_INDEX`, `UNSUPPORTED_VERSION` or `SERIALIZED_INDEX_TOO_LARGE`. Stored terms are taken as they are, so load snapshots you wrote, or lower `loadLimits` for anything else.

Residual cost for untrusted input: `filter` and `sortBy` may name keys outside `keys`, which `loadIndex` never walks. A snapshot that came through `structuredClone` can hold a huge sparse array there, and that costs time on each query that filters or sorts by it. Round trip an untrusted cloned snapshot through `JSON.parse(JSON.stringify(snapshot))` before `loadIndex`.

### Worker recipe

Build on the main thread, send the snapshot, load it in the worker. The example runs both halves in one process: the snapshot goes through a `MessageChannel`, whose structured clone is what `postMessage` to a worker uses, and through `JSON.stringify`. The `startWorker` function is the half that belongs in the worker file; the rest runs on the main thread.

```ts
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { createIndex, type SearchIndex } from 'typoseek';
import { loadIndex, type SerializedIndex } from 'typoseek/serialize';

interface Note {
  id: number;
  text: string;
}

type Request = { type: 'load'; snapshot: SerializedIndex<Note> } | { type: 'search'; query: string };

type Response = { type: 'loaded'; size: number } | { type: 'found'; ids: number[] };

function startWorker(port: MessagePort): void {
  let index: SearchIndex<Note> | undefined;
  port.on('message', (request: Request) => {
    if (request.type === 'load') {
      index = loadIndex<Note>(request.snapshot);
      port.postMessage({ type: 'loaded', size: index.size } satisfies Response);
    } else if (index !== undefined) {
      const ids = index.search(request.query).hits.map((hit) => hit.item.id);
      port.postMessage({ type: 'found', ids } satisfies Response);
    }
  });
}

function ask(port: MessagePort, request: Request): Promise<Response> {
  return new Promise((resolve) => {
    port.once('message', (response: Response) => {
      resolve(response);
    });
    port.postMessage(request);
  });
}

const index = createIndex<Note>({ idKey: 'id', keys: ['text'] });
index.addAll([
  { id: 1, text: 'Water the plants' },
  { id: 2, text: 'Book the dentist' },
]);

const { port1: mainPort, port2: workerPort } = new MessageChannel();
startWorker(workerPort);

console.log(JSON.stringify(await ask(mainPort, { type: 'load', snapshot: index.toJSON() })));
console.log(JSON.stringify(await ask(mainPort, { type: 'search', query: 'dentst' })));
mainPort.close();
workerPort.close();

const fromJson = loadIndex<Note>(JSON.parse(JSON.stringify(index.toJSON())));
const plantHits = fromJson.search('plants').hits;
console.log(plantHits.map((hit) => hit.id).join(','));
```

```text
{"type":"loaded","size":2}
{"type":"found","ids":[2]}
1
```
