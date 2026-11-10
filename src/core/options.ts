import type { Limits, LoadLimits, Normalizer, SearchOptions, Stemmer, Tokenizer } from '../types';
import { TyposeekError } from './errors';
import { compileFilter, compileSort, type CompiledSort } from './filters';
import { isArray, isForbiddenPropertyName, isObjectRecord, KEY_PATH_RULE, parseKeyPath } from './paths';
import { isIterableObject } from './tokenize';

interface IntegerRange {
  readonly min: number;
  readonly max: number;
}

type IntegerFieldsCheck = { readonly values: Readonly<Record<string, number>> } | { readonly problem: string };

export const DEFAULT_LIMITS: Limits = Object.freeze({ maxQueryLength: 256, maxQueryTerms: 16, maxExpansions: 50 });

const LIMIT_RANGES: Readonly<Record<keyof Limits, IntegerRange>> = {
  maxQueryLength: { min: 1, max: 4096 },
  maxQueryTerms: { min: 1, max: 64 },
  maxExpansions: { min: 1, max: 1000 },
};

export type LimitsCheck = { readonly limits: Limits } | { readonly problem: string };

function invalidOption(problem: string): TyposeekError {
  return new TyposeekError('INVALID_OPTION', problem);
}

function isIntegerInRange(value: unknown, range: IntegerRange): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= range.min && value <= range.max;
}

function rangeProblem(option: string, range: IntegerRange): string {
  const accepted =
    range.max === Infinity
      ? `an integer >= ${String(range.min)}`
      : `an integer from ${String(range.min)} to ${String(range.max)}`;
  return `${option} must be ${accepted}`;
}

function checkIntegerFields(
  option: string,
  partial: unknown,
  ranges: Readonly<Record<string, IntegerRange>>,
): IntegerFieldsCheck {
  if (partial === undefined) {
    return { values: {} };
  }
  if (!isObjectRecord(partial)) {
    return { problem: `${option} must be an object` };
  }
  const values: Record<string, number> = {};
  for (const [field, range] of Object.entries(ranges)) {
    const value = partial[field];
    if (value === undefined) {
      continue;
    }
    if (!isIntegerInRange(value, range)) {
      return { problem: rangeProblem(`${option}.${field}`, range) };
    }
    values[field] = value;
  }
  return { values };
}

export function checkLimits(partial: unknown): LimitsCheck {
  const check = checkIntegerFields('limits', partial, LIMIT_RANGES);
  return 'problem' in check ? check : { limits: Object.freeze({ ...DEFAULT_LIMITS, ...check.values }) };
}

export function resolveLimits(partial: unknown): Limits {
  const check = checkLimits(partial);
  if ('problem' in check) {
    throw invalidOption(check.problem);
  }
  return check.limits;
}

export const DEFAULT_LOAD_LIMITS: LoadLimits = Object.freeze({
  maxRecords: 1_000_000,
  maxSurfaces: 5_000_000,
  maxTokens: 50_000_000,
  maxStopTerms: 10_000,
});

const POSITIVE_INTEGER: IntegerRange = { min: 1, max: Infinity };

const LOAD_LIMIT_RANGES: Readonly<Record<keyof LoadLimits, IntegerRange>> = {
  maxRecords: POSITIVE_INTEGER,
  maxSurfaces: POSITIVE_INTEGER,
  maxTokens: POSITIVE_INTEGER,
  maxStopTerms: POSITIVE_INTEGER,
};

export function resolveLoadLimits(partial: unknown): LoadLimits {
  const check = checkIntegerFields('loadLimits', partial, LOAD_LIMIT_RANGES);
  if ('problem' in check) {
    throw invalidOption(check.problem);
  }
  return Object.freeze({ ...DEFAULT_LOAD_LIMITS, ...check.values });
}

export function isValidIdKey(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && !isForbiddenPropertyName(value);
}

export function resolveIdKey(value: unknown): string {
  if (!isValidIdKey(value)) {
    throw invalidOption('idKey must be a non-empty string other than __proto__, constructor and prototype');
  }
  return value;
}

export interface ResolvedField {
  readonly path: string;
  readonly segments: readonly string[];
  readonly weight: number;
}

export const SELF_FIELD: ResolvedField = Object.freeze({ path: '', segments: Object.freeze([]), weight: 1 });

export type KeySpecCheck = { readonly fields: readonly ResolvedField[] } | { readonly problem: string };

type FieldCheck = { readonly field: ResolvedField } | { readonly problem: string };

const DEFAULT_KEY_WEIGHT = 1;

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function toField(path: unknown, weight: number, option: string): FieldCheck {
  if (typeof path === 'string') {
    const segments = parseKeyPath(path);
    if (segments !== undefined) {
      return { field: Object.freeze({ path, segments, weight }) };
    }
  }
  return { problem: `${option} must be ${KEY_PATH_RULE}` };
}

function checkKeySpec(spec: unknown, option: string): FieldCheck {
  if (typeof spec === 'string') {
    return toField(spec, DEFAULT_KEY_WEIGHT, option);
  }
  if (!isObjectRecord(spec)) {
    return { problem: `${option} must be a key path or an object with path and weight` };
  }
  const { path, weight } = spec;
  if (!isPositiveFinite(weight)) {
    return { problem: `${option}.weight must be a finite number > 0` };
  }
  return toField(path, weight, `${option}.path`);
}

export function checkKeySpecs(specs: unknown): KeySpecCheck {
  if (!isArray(specs) || specs.length === 0) {
    return { problem: 'keys must be a non-empty array of key paths or objects with path and weight' };
  }
  const fields: ResolvedField[] = [];
  const seenPaths = new Set<string>();
  for (const [index, spec] of specs.entries()) {
    const option = `keys[${String(index)}]`;
    const check = checkKeySpec(spec, option);
    if ('problem' in check) {
      return check;
    }
    if (seenPaths.has(check.field.path)) {
      return { problem: `${option} repeats the path of an earlier key` };
    }
    seenPaths.add(check.field.path);
    fields.push(check.field);
  }
  return { fields: Object.freeze(fields) };
}

export function resolveKeySpecs(specs: unknown): readonly ResolvedField[] {
  const check = checkKeySpecs(specs);
  if ('problem' in check) {
    throw invalidOption(check.problem);
  }
  return check.fields;
}

export interface PipelineHooks {
  readonly tokenize: Tokenizer | undefined;
  readonly normalize: Normalizer | undefined;
  readonly stem: Stemmer | undefined;
}

export interface ResolvedPipelineOptions {
  readonly hooks: PipelineHooks;
  readonly stopWords: readonly string[];
}

type OptionObject = Readonly<Record<string, unknown>>;

const NO_STOP_WORDS: readonly string[] = Object.freeze([]);

function toOptionObject(options: unknown): OptionObject {
  if (!isObjectRecord(options)) {
    throw invalidOption('options must be an object');
  }
  return options;
}

function isTokenizer(value: unknown): value is Tokenizer {
  return typeof value === 'function';
}

function isTermFunction(value: unknown): value is Normalizer & Stemmer {
  return typeof value === 'function';
}

function hookOption<Hook>(value: unknown, option: string, isHook: (value: unknown) => value is Hook): Hook | undefined {
  if (value === undefined || isHook(value)) {
    return value;
  }
  throw invalidOption(`${option} must be a function`);
}

function resolveHooks(options: OptionObject): PipelineHooks {
  return Object.freeze({
    tokenize: hookOption(options.tokenize, 'tokenize', isTokenizer),
    normalize: hookOption(options.normalize, 'normalize', isTermFunction),
    stem: hookOption(options.stem, 'stem', isTermFunction),
  });
}

function resolveStopWords(value: unknown): readonly string[] {
  if (value === undefined) {
    return NO_STOP_WORDS;
  }
  if (!isIterableObject(value)) {
    throw invalidOption('stopWords must be an iterable of strings, not a string');
  }
  const stopWords: string[] = [];
  for (const word of value) {
    if (typeof word !== 'string') {
      throw invalidOption('stopWords must hold only strings');
    }
    stopWords.push(word);
  }
  return Object.freeze(stopWords);
}

export function resolvePipelineOptions(options: unknown): ResolvedPipelineOptions {
  const source = toOptionObject(options);
  return Object.freeze({ hooks: resolveHooks(source), stopWords: resolveStopWords(source.stopWords) });
}

export interface ResolvedLoadOptions {
  readonly hooks: PipelineHooks;
  readonly loadLimits: LoadLimits;
}

const SNAPSHOT_OWNED_OPTIONS: readonly string[] = ['stopWords', 'limits'];

export function resolveLoadOptions(options: unknown): ResolvedLoadOptions {
  const source = toOptionObject(options);
  const snapshotOwned = SNAPSHOT_OWNED_OPTIONS.find((option) => Object.hasOwn(source, option));
  if (snapshotOwned !== undefined) {
    throw invalidOption(`${snapshotOwned} cannot be passed to loadIndex, because the snapshot holds it`);
  }
  return Object.freeze({ hooks: resolveHooks(source), loadLimits: resolveLoadLimits(source.loadLimits) });
}

export interface ResolvedTypos {
  readonly minLengthForOne: number;
  readonly minLengthForTwo: number;
}

export interface ResolvedSearchOptions<T> {
  readonly mode: 'and' | 'or';
  readonly prefix: boolean;
  readonly infix: boolean;
  readonly typos: ResolvedTypos | false;
  readonly fold: boolean;
  readonly filter: ((item: T) => boolean) | undefined;
  readonly sortBy: CompiledSort<T> | undefined;
  readonly limit: number;
  readonly offset: number;
  readonly truncateQuery: boolean;
}

const DEFAULT_TYPOS: ResolvedTypos = Object.freeze({ minLengthForOne: 4, minLengthForTwo: 8 });

const MIN_LENGTH_FOR_ONE_RANGE: IntegerRange = { min: 1, max: Infinity };

const BOOLEAN_SEARCH_DEFAULTS = { prefix: true, infix: true, fold: true, truncateQuery: false } as const;

const DEFAULT_SEARCH_LIMIT = 20;

const SEARCH_LIMIT_RANGE: IntegerRange = { min: 0, max: 1000 };

const DEFAULT_OFFSET = 0;

const OFFSET_RANGE: IntegerRange = { min: 0, max: Infinity };

const NO_OPTIONS: OptionObject = Object.freeze({});

function integerOption(value: unknown, option: string, fallback: number, range: IntegerRange): number {
  if (value === undefined) {
    return fallback;
  }
  if (!isIntegerInRange(value, range)) {
    throw invalidOption(rangeProblem(option, range));
  }
  return value;
}

function booleanOption(options: OptionObject, option: keyof typeof BOOLEAN_SEARCH_DEFAULTS): boolean {
  const value = options[option];
  if (value === undefined) {
    return BOOLEAN_SEARCH_DEFAULTS[option];
  }
  if (typeof value !== 'boolean') {
    throw invalidOption(`${option} must be a boolean`);
  }
  return value;
}

function modeOption(value: unknown): ResolvedSearchOptions<unknown>['mode'] {
  if (value === undefined) {
    return 'and';
  }
  if (value !== 'and' && value !== 'or') {
    throw invalidOption("mode must be 'and' or 'or'");
  }
  return value;
}

function isMinLengthForTwo(value: unknown, minLengthForOne: number): value is number {
  return value === Infinity || isIntegerInRange(value, { min: minLengthForOne, max: Infinity });
}

function typosOption(value: unknown): ResolvedTypos | false {
  if (value === undefined) {
    return DEFAULT_TYPOS;
  }
  if (value === false) {
    return false;
  }
  if (!isObjectRecord(value)) {
    throw invalidOption('typos must be false or an object');
  }
  const minLengthForOne = integerOption(
    value.minLengthForOne,
    'typos.minLengthForOne',
    DEFAULT_TYPOS.minLengthForOne,
    MIN_LENGTH_FOR_ONE_RANGE,
  );
  const { minLengthForTwo = DEFAULT_TYPOS.minLengthForTwo } = value;
  if (!isMinLengthForTwo(minLengthForTwo, minLengthForOne)) {
    throw invalidOption('typos.minLengthForTwo must be an integer >= typos.minLengthForOne, or Infinity');
  }
  return Object.freeze({ minLengthForOne, minLengthForTwo });
}

export function resolveSearchOptions<T>(options: SearchOptions<T> | undefined): ResolvedSearchOptions<T> {
  const source = options === undefined ? NO_OPTIONS : toOptionObject(options);
  return Object.freeze({
    mode: modeOption(source.mode),
    prefix: booleanOption(source, 'prefix'),
    infix: booleanOption(source, 'infix'),
    typos: typosOption(source.typos),
    fold: booleanOption(source, 'fold'),
    filter: compileFilter(options?.filter),
    sortBy: compileSort(options?.sortBy),
    limit: integerOption(source.limit, 'limit', DEFAULT_SEARCH_LIMIT, SEARCH_LIMIT_RANGE),
    offset: integerOption(source.offset, 'offset', DEFAULT_OFFSET, OFFSET_RANGE),
    truncateQuery: booleanOption(source, 'truncateQuery'),
  });
}

export function capQueryLength(query: string, maxCodePoints: number, truncate: boolean): string {
  let codePoints = 0;
  let keptLength = 0;
  for (const codePoint of query) {
    if (codePoints === maxCodePoints) {
      if (!truncate) {
        throw new TyposeekError(
          'QUERY_TOO_LONG',
          `query exceeds limits.maxQueryLength of ${String(maxCodePoints)} code points`,
        );
      }
      return query.slice(0, keptLength);
    }
    codePoints += 1;
    keptLength += codePoint.length;
  }
  return query;
}

export function capTerms<E>(terms: readonly E[], maxTerms: number, truncate: boolean): readonly E[] {
  if (terms.length <= maxTerms) {
    return terms;
  }
  if (!truncate) {
    throw new TyposeekError('TOO_MANY_TERMS', `query exceeds limits.maxQueryTerms of ${String(maxTerms)} terms`);
  }
  return terms.slice(0, maxTerms);
}

export function typoLimit(codePointLength: number, typos: ResolvedTypos): 0 | 1 | 2 {
  if (codePointLength >= typos.minLengthForTwo) {
    return 2;
  }
  return codePointLength >= typos.minLengthForOne ? 1 : 0;
}
