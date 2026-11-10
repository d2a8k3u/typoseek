const UNREACHABLE = Number.POSITIVE_INFINITY;

interface LastRowDistances {
  readonly whole: number;
  readonly closestPrefix: number;
}

function lastRowDistances(source: readonly string[], target: readonly string[]): LastRowDistances {
  let rowBeforePrevious: readonly number[] = [];
  let previousRow: readonly number[] = Array.from({ length: target.length + 1 }, (_, column) => column);
  let whole = target.length;
  let closestPrefix = 0;
  for (const [sourceIndex, sourceCharacter] of source.entries()) {
    const row = [sourceIndex + 1];
    let diagonal = sourceIndex;
    let left = sourceIndex + 1;
    let rowMinimum = left;
    for (const [targetIndex, above] of previousRow.slice(1).entries()) {
      const targetCharacter = target[targetIndex];
      const beforeSwappedPair = rowBeforePrevious[targetIndex - 1] ?? UNREACHABLE;
      const isAdjacentSwap = sourceCharacter === target[targetIndex - 1] && source[sourceIndex - 1] === targetCharacter;
      left = Math.min(
        above + 1,
        left + 1,
        diagonal + (sourceCharacter === targetCharacter ? 0 : 1),
        isAdjacentSwap ? beforeSwappedPair + 1 : UNREACHABLE,
      );
      row.push(left);
      rowMinimum = Math.min(rowMinimum, left);
      diagonal = above;
    }
    rowBeforePrevious = previousRow;
    previousRow = row;
    whole = left;
    closestPrefix = rowMinimum;
  }
  return { whole, closestPrefix };
}

function withinEdits(distance: number, maxEdits: number): number | undefined {
  return distance <= maxEdits ? distance : undefined;
}

export function osaDistance(a: string, b: string): number {
  return lastRowDistances(Array.from(a), Array.from(b)).whole;
}

export function boundedOsaDistance(a: string, b: string, maxEdits: number): number | undefined {
  const source = Array.from(a);
  const target = Array.from(b);
  if (Math.abs(source.length - target.length) > maxEdits) {
    return undefined;
  }
  return withinEdits(lastRowDistances(source, target).whole, maxEdits);
}

export function boundedPrefixDistance(query: string, candidate: string, maxEdits: number): number | undefined {
  const source = Array.from(query);
  const reachablePrefix = Array.from(candidate).slice(0, source.length + maxEdits);
  return withinEdits(lastRowDistances(source, reachablePrefix).closestPrefix, maxEdits);
}
