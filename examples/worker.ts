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
