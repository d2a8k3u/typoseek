import { createIndex, isTyposeekError } from 'typoseek';

interface Tag {
  id: number;
  label: string;
}

const index = createIndex<Tag>({ idKey: 'id', keys: ['label'], limits: { maxQueryTerms: 2 } });
index.add({ id: 1, label: 'garden' });

function attempt(name: string, action: () => unknown): void {
  try {
    action();
    console.log(name, 'ok');
  } catch (error) {
    if (!isTyposeekError(error)) {
      throw error;
    }
    console.log(name, error.code, error.recordIndex ?? '-');
  }
}

attempt('duplicate id', () => {
  index.add({ id: 1, label: 'again' });
});
attempt('duplicate in batch', () => {
  index.addAll([
    { id: 2, label: 'fence' },
    { id: 2, label: 'gate' },
  ]);
});
attempt('unknown id', () => {
  index.remove(99);
});
attempt('too many terms', () => index.search('one two three'));
attempt('truncated', () => index.search('one two three', { truncateQuery: true }));
attempt('bad option', () => index.search('garden', { limit: -1 }));
attempt('bad record', () => {
  index.add(null as unknown as Tag);
});
