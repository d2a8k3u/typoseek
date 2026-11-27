# API reference

Every export, by entry point.

## `typoseek`

- `createIndex`: creates a `SearchIndex<T>`; takes `IndexOptions<T>`.
- `search`: one-shot search over `string` items or objects with `keys`; returns `SearchResponse<ArrayHit<T>>`.
- `tokenize`: the default tokenizer, returns `TokenSpan[]`.
- `foldTerm`: the default normalizer.
- `TyposeekError`: the error class, with `code` and `recordIndex`.
- `isTyposeekError`: type guard for `TyposeekError`.
- `ErrorCode`: the union of error codes in [Errors](errors.md).
- `SearchIndex`: `size`, `has`, `add`, `addAll`, `addAllAsync`, `update`, `remove`, `search`, `toJSON`.
- `SearchOptions`, `Filter`, `RangeBounds`, `SortBy`, `TypoTolerance`: search options.
- `IndexOptions`, `KeySpec`, `IdKey`, `KeyPath`, `TextPath`, `ValuePath`, `Limits`: index options and key path types.
- `StringSearchOptions`, `ObjectSearchOptions`: options of `search`.
- `PipelineOptions`, `PipelineFunctions`, `Tokenizer`, `Normalizer`, `Stemmer`, `TokenSpan`: pipeline types.
- `SearchResponse`, `IndexHit`, `ArrayHit`, `FieldMatch`, `Range`, `Id`: result types.
- `AsyncAddOptions`, `AbortSignalLike`: options of `addAllAsync`; any `AbortSignal` fits `AbortSignalLike`.
- `SerializedIndex`: the snapshot type.

## `typoseek/serialize`

- `loadIndex`: restores a `SearchIndex<T>` from a snapshot; `loadIndex<Book>(data)` gives `SearchIndex<Book>`, without a type argument it gives `SearchIndex<object>`.
- `LoadOptions`, `LoadLimits`: its options.
- Types re-exported from `typoseek`: `AbortSignalLike`, `AsyncAddOptions`, `FieldMatch`, `Filter`, `Id`, `IndexHit`, `KeyPath`, `Limits`, `Normalizer`, `PipelineFunctions`, `Range`, `RangeBounds`, `SearchIndex`, `SearchOptions`, `SearchResponse`, `SerializedIndex`, `SortBy`, `Stemmer`, `TokenSpan`, `Tokenizer`, `TypoTolerance`, `ValuePath`.

## `typoseek/segmenter`

- `createSegmenterTokenizer`: a `Tokenizer` over `Intl.Segmenter` word segments.
- `TokenSpan`, `Tokenizer`: re-exported types.
