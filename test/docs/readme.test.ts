import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test, vi } from 'vitest';

const EXAMPLES_DIRECTORY = fileURLToPath(new URL('../../examples/', import.meta.url));
const README_FILE = fileURLToPath(new URL('../../README.md', import.meta.url));
const FENCED_BLOCK = /^```(\w*)\n([\s\S]*?)^```$/gm;
const EXAMPLE_FILE_SUFFIX = '.ts';
const TYPESCRIPT_FENCE = 'ts';
const OUTPUT_FENCE = 'text';

interface FencedBlock {
  readonly language: string;
  readonly content: string;
}

function readFencedBlocks(markdown: string): readonly FencedBlock[] {
  return Array.from(markdown.matchAll(FENCED_BLOCK), (match) => ({
    language: match[1] ?? '',
    content: (match[2] ?? '').trimEnd(),
  }));
}

function exampleNames(): readonly string[] {
  return readdirSync(EXAMPLES_DIRECTORY)
    .filter((file) => file.endsWith(EXAMPLE_FILE_SUFFIX))
    .map((file) => file.slice(0, -EXAMPLE_FILE_SUFFIX.length))
    .sort();
}

function exampleSource(name: string): string {
  return readFileSync(`${EXAMPLES_DIRECTORY}${name}${EXAMPLE_FILE_SUFFIX}`, 'utf8').trimEnd();
}

const blocks = readFencedBlocks(readFileSync(README_FILE, 'utf8'));
const names = exampleNames();

function readmeBlockIndex(name: string): number {
  const source = exampleSource(name);
  return blocks.findIndex((block) => block.language === TYPESCRIPT_FENCE && block.content === source);
}

async function runExample(name: string): Promise<string> {
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
    lines.push(parts.map(String).join(' '));
  });
  await import(`../../examples/${name}.ts`);
  return lines.join('\n');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('README code blocks', () => {
  test('every ts block equals one file in examples', () => {
    const sources = new Set(names.map(exampleSource));
    const tsBlocks = blocks.filter((block) => block.language === TYPESCRIPT_FENCE);
    expect(tsBlocks.length).toBeGreaterThan(0);
    expect(tsBlocks.filter((block) => !sources.has(block.content))).toEqual([]);
  });

  test.each(names)('examples/%s.ts is in the README once', (name) => {
    const source = exampleSource(name);
    const occurrences = blocks.filter((block) => block.language === TYPESCRIPT_FENCE && block.content === source);
    expect(occurrences).toHaveLength(1);
  });

  test.each(names)('examples/%s.ts prints the output that follows it in the README', async (name) => {
    const index = readmeBlockIndex(name);
    const documented = blocks[index + 1];
    expect(documented?.language).toBe(OUTPUT_FENCE);
    expect(await runExample(name)).toBe(documented?.content);
  });
});
