import type { Filter, SortBy } from '../types';
import { TyposeekError } from './errors';
import {
  isObjectRecord,
  KEY_PATH_RULE,
  parseKeyPath,
  resolveValues,
  toComparableValue,
  type ComparableValue,
} from './paths';

interface NumericRange {
  readonly lower: number;
  readonly lowerInclusive: boolean;
  readonly upper: number;
  readonly upperInclusive: boolean;
}

type EqualsValue = string | number | boolean | null;

function invalidOption(option: string, rule: string): TyposeekError {
  return new TyposeekError('INVALID_OPTION', `${option} ${rule}`);
}

function keySegments(key: unknown, option: string): readonly string[] {
  const segments = typeof key === 'string' ? parseKeyPath(key) : undefined;
  if (segments === undefined) {
    throw invalidOption(option, `must be ${KEY_PATH_RULE}`);
  }
  return segments;
}

function toNumber(value: ComparableValue | undefined): number | undefined {
  if (typeof value === 'number') {
    return value;
  }
  return typeof value === 'object' && value !== null ? value.dateMs : undefined;
}

function boundOf(bound: unknown, option: string, unbounded: number): number {
  if (bound === undefined) {
    return unbounded;
  }
  const numeric = toNumber(toComparableValue(bound));
  if (numeric === undefined) {
    throw invalidOption(option, 'must be a finite number or a valid Date');
  }
  return numeric;
}

function toNumericRange(bounds: unknown, option: string): NumericRange {
  if (!isObjectRecord(bounds)) {
    throw invalidOption(option, 'must be an object with gt, gte, lt or lte');
  }
  const { gt, gte, lt, lte } = bounds;
  if (gt === undefined && gte === undefined && lt === undefined && lte === undefined) {
    throw invalidOption(option, 'needs at least one of gt, gte, lt and lte');
  }
  if (gt !== undefined && gte !== undefined) {
    throw invalidOption(option, 'cannot have both gt and gte');
  }
  if (lt !== undefined && lte !== undefined) {
    throw invalidOption(option, 'cannot have both lt and lte');
  }
  return {
    lower: gt === undefined ? boundOf(gte, `${option}.gte`, -Infinity) : boundOf(gt, `${option}.gt`, -Infinity),
    lowerInclusive: gt === undefined,
    upper: lt === undefined ? boundOf(lte, `${option}.lte`, Infinity) : boundOf(lt, `${option}.lt`, Infinity),
    upperInclusive: lt === undefined,
  };
}

function isInside(value: number, range: NumericRange): boolean {
  const aboveLower = range.lowerInclusive ? value >= range.lower : value > range.lower;
  const belowUpper = range.upperInclusive ? value <= range.upper : value < range.upper;
  return aboveLower && belowUpper;
}

function isEqualsValue(value: unknown): value is EqualsValue {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    value === null ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function compileRangePredicate(segments: readonly string[], range: NumericRange): (item: unknown) => boolean {
  return (item) =>
    resolveValues(item, segments).some((value) => {
      const numeric = toNumber(value);
      return numeric !== undefined && isInside(numeric, range);
    });
}

function compileEqualsPredicate(segments: readonly string[], equals: EqualsValue): (item: unknown) => boolean {
  return (item) => resolveValues(item, segments).some((value) => value === equals);
}

function compileKeyFilter(spec: unknown, option: string): (item: unknown) => boolean {
  if (!isObjectRecord(spec)) {
    throw invalidOption(option, 'must be a predicate or an object with key and equals or range');
  }
  const segments = keySegments(spec.key, `${option}.key`);
  const { equals, range } = spec;
  if ((equals === undefined) === (range === undefined)) {
    throw invalidOption(option, 'must have exactly one of equals and range');
  }
  if (range !== undefined) {
    return compileRangePredicate(segments, toNumericRange(range, `${option}.range`));
  }
  if (!isEqualsValue(equals)) {
    throw invalidOption(`${option}.equals`, 'must be a string, a finite number, a boolean or null');
  }
  return compileEqualsPredicate(segments, equals);
}

function compileOne<T>(filter: Filter<T>, option: string): (item: T) => boolean {
  return typeof filter === 'function' ? filter : compileKeyFilter(filter, option);
}

function isFilterList<T>(filter: Filter<T> | readonly Filter<T>[]): filter is readonly Filter<T>[] {
  return Array.isArray(filter);
}

export function compileFilter<T>(
  filter: Filter<T> | readonly Filter<T>[] | undefined,
): ((item: T) => boolean) | undefined {
  if (filter === undefined) {
    return undefined;
  }
  if (!isFilterList(filter)) {
    return compileOne(filter, 'filter');
  }
  const predicates = filter.map((entry, index) => compileOne(entry, `filter[${String(index)}]`));
  return (item) => predicates.every((predicate) => predicate(item));
}

type SortKey =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'missing' };

export interface CompiledSort<T> {
  readonly keyOf: (item: T) => SortKey;
  readonly compare: (a: SortKey, b: SortKey) => number;
}

type PresentSortKey = Exclude<SortKey, { readonly kind: 'missing' }>;

const MISSING_SORT_KEY: SortKey = Object.freeze({ kind: 'missing' });

const ASCENDING_KIND_RANK: Readonly<Record<PresentSortKey['kind'], number>> = { number: 0, string: 1, boolean: 2 };

const ASCENDING_SIGN = 1;

const DESCENDING_SIGN = -1;

function toSortKey(value: ComparableValue | undefined): SortKey {
  if (typeof value === 'string') {
    return { kind: 'string', value };
  }
  if (typeof value === 'boolean') {
    return { kind: 'boolean', value };
  }
  const numeric = toNumber(value);
  return numeric === undefined ? MISSING_SORT_KEY : { kind: 'number', value: numeric };
}

function compareCodeUnits(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function compareAscending(a: PresentSortKey, b: PresentSortKey): number {
  if (a.kind === 'number' && b.kind === 'number') {
    return a.value - b.value;
  }
  if (a.kind === 'string' && b.kind === 'string') {
    return compareCodeUnits(a.value, b.value);
  }
  if (a.kind === 'boolean' && b.kind === 'boolean') {
    return Number(a.value) - Number(b.value);
  }
  return ASCENDING_KIND_RANK[a.kind] - ASCENDING_KIND_RANK[b.kind];
}

function directionSign(direction: unknown): number {
  if (direction === undefined || direction === 'asc') {
    return ASCENDING_SIGN;
  }
  if (direction === 'desc') {
    return DESCENDING_SIGN;
  }
  throw invalidOption('sortBy.direction', "must be 'asc' or 'desc'");
}

export function compileSort<T>(sortBy: SortBy<T> | undefined): CompiledSort<T> | undefined {
  if (sortBy === undefined) {
    return undefined;
  }
  const spec: unknown = sortBy;
  if (!isObjectRecord(spec)) {
    throw invalidOption('sortBy', 'must be an object with key and an optional direction');
  }
  const segments = keySegments(spec.key, 'sortBy.key');
  const sign = directionSign(spec.direction);
  return Object.freeze({
    keyOf: (item: T) => toSortKey(resolveValues(item, segments)[0]),
    compare: (a: SortKey, b: SortKey) => {
      if (a.kind === 'missing' || b.kind === 'missing') {
        return Number(a.kind === 'missing') - Number(b.kind === 'missing');
      }
      return sign * compareAscending(a, b);
    },
  });
}
