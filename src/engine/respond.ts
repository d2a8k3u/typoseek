import { TyposeekError } from '../core/errors';
import type { ResolvedSearchOptions } from '../core/options';
import type { FieldMatch, SearchResponse } from '../types';
import { executeSearch } from './execute';
import { highlightRecord } from './highlight';
import { indexedDoc, type DocEntry, type IndexState } from './state';

export function checkedQuery(query: unknown): string {
  if (typeof query !== 'string') {
    throw new TyposeekError('INVALID_OPTION', 'query must be a string');
  }
  return query;
}

type HitOf<T, H> = (doc: DocEntry<T>, docNum: number, matches: readonly FieldMatch[]) => H;

export function searchResponse<T, H>(
  state: IndexState<T>,
  query: string,
  options: ResolvedSearchOptions<T>,
  hitOf: HitOf<T, H>,
): SearchResponse<H> {
  const { total, page } = executeSearch(state, query, options);
  const hits = page.map((ranked) =>
    hitOf(indexedDoc(state, ranked.docNum), ranked.docNum, highlightRecord(state, ranked)),
  );
  return { total, hits };
}
