import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ENTRIES = ['src/index.ts', 'src/serialize.ts', 'src/segmenter.ts'];
const FENCED_BLOCK = /^```[\s\S]*?^```$/gm;
const INLINE_CODE = /`([^`\n]+)`/g;

function compilerOptions(): ts.CompilerOptions {
  const config: unknown = JSON.parse(readFileSync(`${ROOT}tsconfig.build.json`, 'utf8'));
  return ts.parseJsonConfigFileContent(config, ts.sys, ROOT).options;
}

function exportedNames(entry: string, program: ts.Program): readonly string[] {
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(`${ROOT}${entry}`);
  const moduleSymbol = sourceFile === undefined ? undefined : checker.getSymbolAtLocation(sourceFile);
  if (moduleSymbol === undefined) {
    throw new Error(`${entry} is not a module`);
  }
  return checker.getExportsOfModule(moduleSymbol).map((symbol) => symbol.getName());
}

function inlineCodeSpans(markdown: string): ReadonlySet<string> {
  const outsideFences = markdown.replace(FENCED_BLOCK, '');
  return new Set(Array.from(outsideFences.matchAll(INLINE_CODE), (match) => match[1] ?? ''));
}

const program = ts.createProgram(
  ENTRIES.map((entry) => `${ROOT}${entry}`),
  compilerOptions(),
);
const documented = inlineCodeSpans(readFileSync(`${ROOT}README.md`, 'utf8'));

describe('README API reference', () => {
  test.each(ENTRIES)('%s: every export appears in the README as inline code', (entry) => {
    const names = exportedNames(entry, program);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => !documented.has(name))).toEqual([]);
  });
});
