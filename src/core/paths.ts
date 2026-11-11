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

interface ArrayCursor {
  readonly array: readonly unknown[];
  readonly length: number;
  readonly depth: number;
  nextIndex: number;
}

type ArrayLengthCharge = (arrayLength: number) => void;

const CHARGE_NOTHING: ArrayLengthCharge = () => undefined;

function collectLeaves<Leaf>(
  record: unknown,
  segments: readonly string[],
  toLeaf: (value: unknown) => Leaf | undefined,
  chargeArrayLength: ArrayLengthCharge,
): readonly Leaf[] {
  const leaves: Leaf[] = [];
  const visitedArrays = new Set<readonly unknown[]>();
  const cursors: ArrayCursor[] = [];
  const visit = (value: unknown, depth: number): void => {
    let current = value;
    let level = depth;
    for (let segment = segments[level]; segment !== undefined && !isArray(current); segment = segments[level]) {
      if (!isObjectRecord(current) || !Object.hasOwn(current, segment)) {
        return;
      }
      current = current[segment];
      level += 1;
    }
    if (!isArray(current)) {
      const leaf = toLeaf(current);
      if (leaf !== undefined) {
        leaves.push(leaf);
      }
    } else if (!visitedArrays.has(current)) {
      visitedArrays.add(current);
      const { length } = current;
      chargeArrayLength(length);
      cursors.push({ array: current, length, depth: level, nextIndex: 0 });
    }
  };
  visit(record, 0);
  for (let cursor = cursors.at(-1); cursor !== undefined; cursor = cursors.at(-1)) {
    const index = cursor.nextIndex;
    if (index >= cursor.length) {
      cursors.pop();
    } else {
      cursor.nextIndex = index + 1;
      if (Object.hasOwn(cursor.array, index)) {
        visit(cursor.array[index], cursor.depth);
      }
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
  return collectLeaves(record, segments, toText, CHARGE_NOTHING);
}

export function resolveMeteredText(
  record: unknown,
  segments: readonly string[],
  chargeArrayLength: ArrayLengthCharge,
): readonly string[] {
  return collectLeaves(record, segments, toText, chargeArrayLength);
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
  return collectLeaves(record, segments, toComparableValue, CHARGE_NOTHING);
}
