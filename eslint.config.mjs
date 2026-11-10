import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import { builtinModules } from 'node:module';
import tseslint from 'typescript-eslint';

const nodeBuiltinImports = {
  paths: builtinModules.map((name) => ({ name, message: 'The package runs without Node built-ins.' })),
  patterns: [{ group: ['node:*'], message: 'The package runs without Node built-ins.' }],
};

const allowOnly = (allowedSources) => ({
  paths: nodeBuiltinImports.paths,
  patterns: [
    ...nodeBuiltinImports.patterns,
    { regex: `^(?!(?:${allowedSources.join('|')})$)`, message: 'Import crosses a layer boundary.' },
  ],
});

const layer = (files, allowedSources) => ({
  files,
  rules: { 'no-restricted-imports': ['error', allowOnly(allowedSources)] },
});

const moduleWithExtension = (path) => `${path}(?:\\.[a-z]+)?`;
const sameDirectory = '\\./.+';
const coreModules = '\\.\\./core/.+';
const engineModules = '\\.\\./engine/.+';
const typesModule = moduleWithExtension('\\.\\./types');

const restrictedGlobals = [
  'globalThis',
  'self',
  'window',
  'document',
  'navigator',
  'process',
  'Buffer',
  'require',
  'module',
  'global',
  '__dirname',
  '__filename',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'importScripts',
  'Worker',
  'SharedWorker',
];

export default defineConfig(
  {
    ignores: [
      'dist',
      'coverage',
      'demo/dist',
      'reports',
      '.stryker-tmp',
      'test/package/fixture',
      'test/runtimes/fixture',
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: 'error',
    },
  },
  {
    files: ['**/*.mjs', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/**'],
    rules: {
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-globals': ['error', ...restrictedGlobals],
      'no-restricted-imports': ['error', nodeBuiltinImports],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='RegExp']", message: 'RegExp construction is banned.' },
        { selector: "CallExpression[callee.name='RegExp']", message: 'RegExp construction is banned.' },
        { selector: 'ImportExpression', message: 'Dynamic import is banned.' },
        { selector: 'PrivateIdentifier', message: 'Use TypeScript private, not #private.' },
        { selector: "BinaryExpression[operator='instanceof']", message: 'instanceof is banned across package copies.' },
        { selector: 'CatchClause', message: 'Silent catches are banned.' },
      ],
    },
  },
  layer(['src/core/**'], [sameDirectory, typesModule]),
  layer(['src/engine/**'], [sameDirectory, coreModules, typesModule]),
  layer(['src/serialize/**'], [sameDirectory, coreModules, engineModules, typesModule]),
  layer(['src/segmenter.ts'], [moduleWithExtension('\\./core/errors'), moduleWithExtension('\\./types')]),
);
