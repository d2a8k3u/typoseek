import { compareCodePoints } from '../core/radix-tree';
import type { SerializedIndex } from '../types';
import { knownSurface, type KeyedState } from './state';

type SnapshotSurface = readonly [surface: string, term: string | null];

export function toSnapshot<T>(state: KeyedState<T>): SerializedIndex<T> {
  const { idKey, fields, limits, pipeline } = state.config;
  const surfaces: SnapshotSurface[] = [];
  const surfaceIndexById = new Map<number, number>();
  const surfaceIndexOf = (surfaceId: number): number => {
    const listed = surfaceIndexById.get(surfaceId);
    if (listed !== undefined) {
      return listed;
    }
    const { surface, term } = knownSurface(state, surfaceId);
    surfaceIndexById.set(surfaceId, surfaces.length);
    surfaces.push([surface, term ?? null]);
    return surfaces.length - 1;
  };
  const snapshotSlot = (slot: number, position: number): number =>
    position < fields.length || slot < 0 ? slot : surfaceIndexOf(slot);
  const records = Array.from(
    state.docs.values(),
    ({ item, stream }) => [item, Array.from(stream, snapshotSlot)] as const,
  );
  return {
    format: 'typoseek-index',
    version: 1,
    idKey,
    keys: fields.map(({ path, weight }) => ({ path, weight })),
    limits: { ...limits },
    stopTerms: [...pipeline.stopTerms].sort(compareCodePoints),
    surfaces,
    records,
  };
}
