export { TyposeekError, isTyposeekError, type ErrorCode } from './core/errors';
export { foldTerm } from './core/fold';
export { tokenize } from './core/tokenize';
export { createIndex } from './engine/create-index';
export { search } from './engine/one-shot';
export type {
  AbortSignalLike,
  ArrayHit,
  AsyncAddOptions,
  FieldMatch,
  Filter,
  Id,
  IdKey,
  IndexHit,
  IndexOptions,
  KeyPath,
  KeySpec,
  Limits,
  Normalizer,
  ObjectSearchOptions,
  PipelineFunctions,
  PipelineOptions,
  Range,
  RangeBounds,
  SearchIndex,
  SearchOptions,
  SearchResponse,
  SerializedIndex,
  SortBy,
  Stemmer,
  StringSearchOptions,
  TextPath,
  TokenSpan,
  Tokenizer,
  TypoTolerance,
  ValuePath,
} from './types';
