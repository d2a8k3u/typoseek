/** @public */
export type Id = string | number;

/** @public */
export type Range = readonly [start: number, end: number];

/** @public */
export interface TokenSpan {
  readonly start: number;
  readonly end: number;
}

/** @public */
export type Tokenizer = (text: string) => Iterable<TokenSpan>;

/** @public */
export type Normalizer = (term: string) => string;

/** @public */
export type Stemmer = (term: string) => string;

/** @public */
export interface PipelineFunctions {
  readonly tokenize?: Tokenizer;
  readonly normalize?: Normalizer;
  readonly stem?: Stemmer;
}

/** @public */
export interface PipelineOptions extends PipelineFunctions {
  readonly stopWords?: Iterable<string>;
}

/** @public */
export interface Limits {
  readonly maxQueryLength: number;
  readonly maxQueryTerms: number;
  readonly maxExpansions: number;
}

/** @public */
export type KeyPath<T, Leaf, Depth extends readonly unknown[] = []> = Depth['length'] extends 5
  ? never
  : T extends object
    ? {
        [K in keyof T]-?: K extends string
          ? NonNullable<T[K]> extends infer Value
            ? Value extends Leaf
              ? K
              : Value extends readonly (infer Element)[]
                ? KeyPath<{ readonly [Key in K]: Element }, Leaf, Depth>
                : `${K}.${KeyPath<Value, Leaf, [...Depth, unknown]>}`
            : never
          : never;
      }[keyof T]
    : never;

/** @public */
export type TextPath<T> = KeyPath<T, string | number>;

/** @public */
export type ValuePath<T> = KeyPath<T, string | number | boolean | Date | null>;

/** @public */
export type IdKey<T> = { [K in keyof T]-?: T[K] extends Id ? K : never }[keyof T] & string;

/** @public */
export type KeySpec<T> = TextPath<T> | { readonly path: TextPath<T>; readonly weight: number };

/** @public */
export interface IndexOptions<T> extends PipelineOptions {
  readonly idKey: NoInfer<IdKey<T>>;
  readonly keys: readonly NoInfer<KeySpec<T>>[];
  readonly limits?: Partial<Limits>;
}

/** @public */
export interface TypoTolerance {
  readonly minLengthForOne?: number;
  readonly minLengthForTwo?: number;
}

/** @public */
export interface RangeBounds {
  readonly gt?: number | Date;
  readonly gte?: number | Date;
  readonly lt?: number | Date;
  readonly lte?: number | Date;
}

/** @public */
export type Filter<T> =
  | ((item: T) => boolean)
  | { readonly key: ValuePath<T>; readonly equals: string | number | boolean | null }
  | { readonly key: ValuePath<T>; readonly range: RangeBounds };

/** @public */
export interface SortBy<T> {
  readonly key: ValuePath<T>;
  readonly direction?: 'asc' | 'desc';
}

/** @public */
export interface SearchOptions<T> {
  readonly mode?: 'and' | 'or';
  readonly prefix?: boolean;
  readonly infix?: boolean;
  readonly typos?: false | TypoTolerance;
  readonly fold?: boolean;
  readonly filter?: Filter<T> | readonly Filter<T>[];
  readonly sortBy?: SortBy<T>;
  readonly limit?: number;
  readonly offset?: number;
  readonly truncateQuery?: boolean;
}

/** @public */
export interface FieldMatch {
  readonly key: string;
  readonly valueIndex: number;
  readonly ranges: readonly Range[];
}

/** @public */
export interface IndexHit<T> {
  readonly id: Id;
  readonly item: T;
  readonly matches: readonly FieldMatch[];
}

/** @public */
export interface ArrayHit<T> {
  readonly refIndex: number;
  readonly item: T;
  readonly matches: readonly FieldMatch[];
}

/** @public */
export interface SearchResponse<H> {
  readonly total: number;
  readonly hits: readonly H[];
}

/** @public */
export interface AbortSignalLike {
  readonly aborted: boolean;
  readonly reason?: unknown;
}

/** @public */
export interface AsyncAddOptions {
  readonly signal?: AbortSignalLike;
}

/** @public */
export interface SearchIndex<T> {
  readonly size: number;
  has(id: Id): boolean;
  add(record: T): void;
  addAll(records: readonly T[]): void;
  addAllAsync(records: readonly T[], options?: AsyncAddOptions): Promise<void>;
  update(record: T): void;
  remove(id: Id): void;
  search(query: string, options?: SearchOptions<T>): SearchResponse<IndexHit<T>>;
  toJSON(): SerializedIndex<T>;
}

/** @public */
export type StringSearchOptions = Omit<SearchOptions<string>, 'filter' | 'sortBy'> &
  PipelineOptions & {
    readonly limits?: Partial<Limits>;
    readonly filter?: ((item: string) => boolean) | readonly ((item: string) => boolean)[];
  };

/** @public */
export type ObjectSearchOptions<T> = SearchOptions<T> &
  PipelineOptions & { readonly limits?: Partial<Limits>; readonly keys: readonly KeySpec<T>[] };

/** @public */
export interface SerializedIndex<T> {
  readonly format: 'typoseek-index';
  readonly version: 1;
  readonly idKey: string;
  readonly keys: readonly { readonly path: string; readonly weight: number }[];
  readonly limits: Limits;
  readonly stopTerms: readonly string[];
  readonly surfaces: readonly (readonly [surface: string, term: string | null])[];
  readonly records: readonly (readonly [item: T, stream: readonly number[]])[];
}

/** @public */
export interface LoadLimits {
  readonly maxRecords: number;
  readonly maxSurfaces: number;
  readonly maxTokens: number;
  readonly maxStopTerms: number;
}

/** @public */
export interface LoadOptions extends PipelineFunctions {
  readonly loadLimits?: Partial<LoadLimits>;
}
