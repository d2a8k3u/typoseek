import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const README_PATH = 'README.md';
const DOCS_DIRECTORY = 'docs';
const MARKDOWN_SUFFIX = '.md';

export interface DocumentationFile {
  readonly path: string;
  readonly markdown: string;
}

function docsPaths(): readonly string[] {
  return readdirSync(`${ROOT}${DOCS_DIRECTORY}`)
    .filter((file) => file.endsWith(MARKDOWN_SUFFIX))
    .sort()
    .map((file) => `${DOCS_DIRECTORY}/${file}`);
}

export function readDocumentation(): readonly DocumentationFile[] {
  return [README_PATH, ...docsPaths()].map((path) => ({ path, markdown: readFileSync(`${ROOT}${path}`, 'utf8') }));
}
