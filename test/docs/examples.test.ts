import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { readDocumentation } from '../support/documentation.ts';

const EXAMPLES_DIRECTORY = fileURLToPath(new URL('../../examples/', import.meta.url));
const FENCED_BLOCK = /^```(\w*)\n([\s\S]*?)^```$/gm;
const EXAMPLE_FILE_SUFFIX = '.ts';
const TYPESCRIPT_FENCE = 'ts';
const OUTPUT_FENCE = 'text';

interface FencedBlock {
  readonly path: string;
  readonly language: string;
  readonly content: string;
}

function readFencedBlocks(path: string, markdown: string): readonly FencedBlock[] {
  return Array.from(markdown.matchAll(FENCED_BLOCK), (match) => ({
    path,
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

function isExampleBlock(block: FencedBlock, source: string): boolean {
  return block.language === TYPESCRIPT_FENCE && block.content === source;
}

const blocksPerFile = readDocumentation().map((file) => readFencedBlocks(file.path, file.markdown));
const blocks = blocksPerFile.flat();
const names = exampleNames();

function blockAfterExample(source: string): FencedBlock | undefined {
  for (const fileBlocks of blocksPerFile) {
    const index = fileBlocks.findIndex((block) => isExampleBlock(block, source));
    if (index !== -1) {
      return fileBlocks[index + 1];
    }
  }
  return undefined;
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

describe('Code blocks in the README and docs/', () => {
  test('every ts block equals one file in examples', () => {
    const sources = new Set(names.map(exampleSource));
    const tsBlocks = blocks.filter((block) => block.language === TYPESCRIPT_FENCE);
    expect(tsBlocks.length).toBeGreaterThan(0);
    expect(tsBlocks.filter((block) => !sources.has(block.content))).toEqual([]);
  });

  test.each(names)('examples/%s.ts appears once across the README and docs/', (name) => {
    const source = exampleSource(name);
    expect(blocks.filter((block) => isExampleBlock(block, source))).toHaveLength(1);
  });

  test.each(names)('examples/%s.ts prints the output that follows it in the same file', async (name) => {
    const documented = blockAfterExample(exampleSource(name));
    expect(documented?.language).toBe(OUTPUT_FENCE);
    expect(await runExample(name)).toBe(documented?.content);
  });
});
