import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publint } from 'publint';
import { beforeAll, describe, expect, test } from 'vitest';
import { COMMAND_TIMEOUT_MS, runCommand } from '../support/command.ts';
import { installPackedPackage, PACKED_INSTALL_TIMEOUT_MS, type PackedInstall } from '../support/pack.ts';

const fixtureSource = fileURLToPath(new URL('fixture', import.meta.url));
const typescriptCompiler = createRequire(import.meta.url).resolve('typescript/bin/tsc');

const DIST_DIRECTORY = 'dist/';
const REQUIRED_ROOT_FILES = ['LICENSE', 'README.md', 'package.json'];
const RUNTIME_DEPENDENCY_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];

const INDEX_OPTIONS = { idKey: 'id', keys: ['title'] };
const RECORDS = [
  { id: 1, title: 'Search engine' },
  { id: 2, title: 'Garden tools' },
];
const TYPO_QUERY = 'serch';
const TYPO_QUERY_HIT_IDS = [1];

const CORE_ENTRY_FILES = ['dist/index.mjs', 'dist/index.cjs'];
const ENGLISH_STOP_WORDS = ['the', 'of', 'to', 'in', 'is', 'that', 'it', 'with', 'for', 'was'];
const CZECH_STOP_WORDS = ['se', 'na', 'je', 'že', 'jsem', 'jako', 'ale', 'pro', 'jsou', 'nebo'];
const STRING_QUOTES = ['"', "'", '`'];
const STOP_WORD_LITERALS = [...ENGLISH_STOP_WORDS, ...CZECH_STOP_WORDS].flatMap((word) =>
  STRING_QUOTES.map((quote) => `${quote}${word}${quote}`),
);
const RELATIVE_SPECIFIER = /\b(?:from|import|require)\s*\(?\s*["'](\.\.?\/[^"']+)["']/g;

let install: PackedInstall;

async function importClosure(entryFile: string): Promise<ReadonlyMap<string, string>> {
  const sources = new Map<string, string>();
  const pending = [entryFile];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (sources.has(file)) {
      continue;
    }
    const source = await readFile(file, 'utf8');
    sources.set(file, source);
    const specifiers = [...source.matchAll(RELATIVE_SPECIFIER)].flatMap((match) => match.slice(1));
    pending.push(...specifiers.map((specifier) => resolve(dirname(file), specifier)));
  }
  return sources;
}

function runFixture(script: string, command: string, payload: object): Promise<string> {
  return runCommand(process.execPath, [script, command], {
    cwd: install.fixtureDirectory,
    input: JSON.stringify(payload),
  });
}

beforeAll(async () => {
  install = await installPackedPackage(fixtureSource);
  return install.remove;
}, PACKED_INSTALL_TIMEOUT_MS);

describe('packed typoseek tarball', { timeout: COMMAND_TIMEOUT_MS * 2 }, () => {
  test('packs package.json, LICENSE, README.md and dist only', () => {
    const rootFiles = install.packedFiles.filter((file) => !file.startsWith(DIST_DIRECTORY)).sort();
    expect(rootFiles).toEqual(REQUIRED_ROOT_FILES);
  });

  test('ships a package.json without runtime dependency fields', async () => {
    const manifest: unknown = JSON.parse(await readFile(join(install.packageDirectory, 'package.json'), 'utf8'));
    for (const field of RUNTIME_DEPENDENCY_FIELDS) {
      expect(manifest).not.toHaveProperty(field);
    }
  });

  test.for([
    { condition: 'import', script: 'esm.mjs' },
    { condition: 'require', script: 'cjs.cjs' },
  ])('finds a record with a typo through $condition', async ({ script }) => {
    const output = await runFixture(script, 'search', { options: INDEX_OPTIONS, records: RECORDS, query: TYPO_QUERY });
    expect(JSON.parse(output)).toEqual(TYPO_QUERY_HIT_IDS);
  });

  test.for([
    { writer: 'esm.mjs', reader: 'cjs.cjs' },
    { writer: 'cjs.cjs', reader: 'esm.mjs' },
  ])('loads an index serialized by $writer into $reader', async ({ writer, reader }) => {
    const snapshot: unknown = JSON.parse(
      await runFixture(writer, 'serialize', { options: INDEX_OPTIONS, records: RECORDS }),
    );
    const output = await runFixture(reader, 'load', { snapshot, query: TYPO_QUERY });
    expect(JSON.parse(output)).toEqual(TYPO_QUERY_HIT_IDS);
  });

  test('compiles a TypeScript consumer under module node16', async () => {
    await expect(
      runCommand(process.execPath, [typescriptCompiler, '-p', 'tsconfig.json'], { cwd: install.fixtureDirectory }),
    ).resolves.toBe('');
  });

  test.for(CORE_ENTRY_FILES)('keeps Segmenter out of the import closure of %s', async (entryFile) => {
    const closure = await importClosure(join(install.packageDirectory, entryFile));
    const filesWithSegmenter = [...closure].filter(([, source]) => source.includes('Segmenter')).map(([file]) => file);
    expect(closure.size).toBeGreaterThan(1);
    expect(filesWithSegmenter).toEqual([]);
  });

  test('ships no stop-word literals in any dist file', async () => {
    const distFiles = install.packedFiles.filter((file) => file.startsWith(DIST_DIRECTORY));
    const sources = await Promise.all(
      distFiles.map(async (file) => ({ file, source: await readFile(join(install.packageDirectory, file), 'utf8') })),
    );
    const findings = sources.flatMap(({ file, source }) =>
      STOP_WORD_LITERALS.filter((literal) => source.includes(literal)).map((literal) => `${file}: ${literal}`),
    );
    expect(findings).toEqual([]);
  });

  test('passes publint at the suggestion level', async () => {
    const { messages } = await publint({ pkgDir: install.packageDirectory, level: 'suggestion' });
    expect(messages).toEqual([]);
  });
});
