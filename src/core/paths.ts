export const MAX_KEY_PATH_SEGMENTS = 5;

export const KEY_PATH_RULE = `a dotted path of 1 to ${String(MAX_KEY_PATH_SEGMENTS)} non-empty segments, none of them __proto__, constructor or prototype`;

const FORBIDDEN_PROPERTY_NAMES: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

export function isForbiddenPropertyName(name: string): boolean {
  return FORBIDDEN_PROPERTY_NAMES.has(name);
}

function isAcceptedSegment(segment: string): boolean {
  return segment !== '' && !isForbiddenPropertyName(segment);
}

export function parseKeyPath(path: string): readonly string[] | undefined {
  const segments = path.split('.', MAX_KEY_PATH_SEGMENTS + 1);
  if (segments.length > MAX_KEY_PATH_SEGMENTS || !segments.every(isAcceptedSegment)) {
    return undefined;
  }
  return Object.freeze(segments);
}

export function isObjectRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

interface PendingValue {
  readonly value: unknown;
  readonly depth: number;
}

function collectLeaves<Leaf>(
  record: unknown,
  segments: readonly string[],
  toLeaf: (value: unknown) => Leaf | undefined,
): readonly Leaf[] {
  const leaves: Leaf[] = [];
  const visitedArrays = new Set<readonly unknown[]>();
  const pending: PendingValue[] = [{ value: record, depth: 0 }];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const { value, depth } = next;
    if (isArray(value)) {
      if (!visitedArrays.has(value)) {
        visitedArrays.add(value);
        for (let index = value.length - 1; index >= 0; index -= 1) {
          pending.push({ value: value[index], depth });
        }
      }
      continue;
    }
    const segment = segments[depth];
    if (segment === undefined) {
      const leaf = toLeaf(value);
      if (leaf !== undefined) {
        leaves.push(leaf);
      }
    } else if (isObjectRecord(value) && Object.hasOwn(value, segment)) {
      pending.push({ value: value[segment], depth: depth + 1 });
    }
  }
  return leaves;
}

function toText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
}

export function resolveText(record: unknown, segments: readonly string[]): readonly string[] {
  return collectLeaves(record, segments, toText);
}

export type ComparableValue = string | number | boolean | null | { readonly dateMs: number };

function isDate(value: unknown): value is Date {
  return (
    typeof value === 'object' &&
    value !== null &&
    !(Symbol.toStringTag in value) &&
    Object.prototype.toString.call(value) === '[object Date]'
  );
}

export function toComparableValue(value: unknown): ComparableValue | undefined {
  if (typeof value === 'string' || typeof value === 'boolean' || value === null) {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (!isDate(value)) {
    return undefined;
  }
  const dateMs = Date.prototype.getTime.call(value);
  return Number.isFinite(dateMs) ? { dateMs } : undefined;
}

export function resolveValues(record: unknown, segments: readonly string[]): readonly ComparableValue[] {
  return collectLeaves(record, segments, toComparableValue);
}
