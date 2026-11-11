import { readFileSync } from 'node:fs';
import { createIndex } from 'typoseek';
import { loadIndex } from 'typoseek/serialize';

const commands = {
  search: ({ options, records, query }) => hitIds(indexOf(options, records).search(query)),
  serialize: ({ options, records }) => indexOf(options, records).toJSON(),
  load: ({ snapshot, query }) => hitIds(loadIndex(snapshot).search(query)),
};

function indexOf(options, records) {
  const index = createIndex(options);
  index.addAll(records);
  return index;
}

function hitIds(response) {
  return response.hits.map((hit) => hit.id);
}

const command = process.argv[2];
if (!Object.hasOwn(commands, command)) {
  throw new Error(`unknown command: ${command}`);
}
process.stdout.write(JSON.stringify(commands[command](JSON.parse(readFileSync(0, 'utf8')))));
