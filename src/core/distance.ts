const UNREACHABLE = Number.POSITIVE_INFINITY;

export interface OsaRow {
  readonly cells: readonly number[];
  readonly cellsOfRowBefore: readonly number[];
  readonly sourceLength: number;
  readonly sourceCharacter: string | undefined;
  readonly last: number;
  readonly minimum: number;
}

export function firstOsaRow(targetLength: number): OsaRow {
  return {
    cells: Array.from({ length: targetLength + 1 }, (_, column) => column),
    cellsOfRowBefore: [],
    sourceLength: 0,
    sourceCharacter: undefined,
    last: targetLength,
    minimum: 0,
  };
}

export function nextOsaRow(target: readonly string[], previous: OsaRow, sourceCharacter: string): OsaRow {
  const cells: number[] = [];
  let column = 0;
  let targetCharacter: string | undefined;
  let targetCharacterBefore: string | undefined;
  let beforeSwappedPair = UNREACHABLE;
  let beforeNextSwappedPair = UNREACHABLE;
  let diagonal = UNREACHABLE;
  let left = UNREACHABLE;
  let minimum = UNREACHABLE;
  for (const above of previous.cells) {
    const isAdjacentSwap = sourceCharacter === targetCharacterBefore && previous.sourceCharacter === targetCharacter;
    left = Math.min(
      above + 1,
      left + 1,
      diagonal + (sourceCharacter === targetCharacter ? 0 : 1),
      isAdjacentSwap ? beforeSwappedPair + 1 : UNREACHABLE,
    );
    cells.push(left);
    minimum = Math.min(minimum, left);
    diagonal = above;
    targetCharacterBefore = targetCharacter;
    targetCharacter = target[column];
    beforeSwappedPair = beforeNextSwappedPair;
    beforeNextSwappedPair = previous.cellsOfRowBefore[column] ?? UNREACHABLE;
    column += 1;
  }
  return {
    cells,
    cellsOfRowBefore: previous.cells,
    sourceLength: previous.sourceLength + 1,
    sourceCharacter,
    last: left,
    minimum,
  };
}

function lastOsaRow(source: readonly string[], target: readonly string[]): OsaRow {
  return source.reduce((row, sourceCharacter) => nextOsaRow(target, row, sourceCharacter), firstOsaRow(target.length));
}

function withinEdits(distance: number, maxEdits: number): number | undefined {
  return distance <= maxEdits ? distance : undefined;
}

export function osaDistance(a: string, b: string): number {
  return lastOsaRow(Array.from(a), Array.from(b)).last;
}

export function boundedOsaDistance(a: string, b: string, maxEdits: number): number | undefined {
  const source = Array.from(a);
  const target = Array.from(b);
  if (Math.abs(source.length - target.length) > maxEdits) {
    return undefined;
  }
  return withinEdits(lastOsaRow(source, target).last, maxEdits);
}

export function boundedPrefixDistance(query: string, candidate: string, maxEdits: number): number | undefined {
  const source = Array.from(query);
  const reachablePrefix = Array.from(candidate).slice(0, source.length + maxEdits);
  return withinEdits(lastOsaRow(source, reachablePrefix).minimum, maxEdits);
}
