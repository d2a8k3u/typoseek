# Benchmark

Search latency, build time, retained heap and async indexing slices of typoseek next to six fuzzy search libraries, all from one run of `npm run bench` on 2026-11-11. The raw numbers are in [`bench/results/2026-11-11T09-05-01.010Z.json`](bench/results/2026-11-11T09-05-01.010Z.json).

## Machine and versions

|                             |                                |
| --------------------------- | ------------------------------ |
| CPU                         | Apple M4 Pro, 14 logical cores |
| Memory                      | 48 GiB                         |
| OS                          | Darwin 27.3.0 (macOS), arm64   |
| Node                        | v24.20.0                       |
| typoseek                    | 0.0.0                          |
| MiniSearch                  | 7.2.0                          |
| Fuse (`fuse.js`)            | 7.5.0                          |
| Orama (`@orama/orama`)      | 3.1.18                         |
| FlexSearch                  | 0.8.212                        |
| fuzzysort                   | 4.0.2                          |
| uFuzzy (`@leeoniya/ufuzzy`) | 1.0.19                         |
| tinybench                   | 6.2.3                          |

## Dataset and queries

`bench/dataset.ts` generates the records from seed 20261110: a vocabulary of 50,000 words of 3 to 12 letters (10% with Czech diacritics), Zipf word frequencies (s = 1), and records of a 3 to 5 word title, a 5 to 7 word body and a one word tag. Each library indexes all three fields.

`bench/queries.ts` draws 200 queries of 2 or 3 words from the records. The last word is kept 40% of the time, gets one edit (insertion, deletion, substitution or adjacent transposition) 25%, two substitutions 20% (words of 8 or more letters), is cut to a prefix 10% and replaced by an inner substring of at least 3 letters 5%. Earlier words are kept, get one edit or two substitutions in the same 40:25:20 ratio.

Each library builds its index 3 times; build time and retained heap are the medians. Retained heap is `heapUsed` after minus before the build, both after `gc()` under `node --expose-gc`, with the index still referenced. Search latency comes from tinybench with one sample per query after 20 warmup queries; p50 and p95 are nearest-rank percentiles of the 200 samples.

## Search latency

| Library    | p95 ms, 10,000 records | p50 ms, 10,000 records | p95 ms, 100,000 records | p50 ms, 100,000 records |
| ---------- | ---------------------- | ---------------------- | ----------------------- | ----------------------- |
| typoseek   | 8.41                   | 4.26                   | 29.65                   | 13.16                   |
| MiniSearch | 2.68                   | 1.12                   | 31.80                   | 6.19                    |
| Fuse       | 150.93                 | 100.88                 | 1,546.18                | 1,028.75                |
| Orama      | 59.22                  | 15.45                  | 5,176.21                | 65.33                   |
| FlexSearch | 0.25                   | 0.005                  | 3.45                    | 0.006                   |
| fuzzysort  | 4.31                   | 1.89                   | 61.40                   | 32.64                   |
| uFuzzy     | 7.69                   | 1.94                   | 69.05                   | 14.91                   |

The libraries do not match the same records, so read latency next to how many of the 200 queries returned at least one result:

| Library    | Queries with results, 10,000 records | Queries with results, 100,000 records |
| ---------- | ------------------------------------ | ------------------------------------- |
| typoseek   | 186                                  | 186                                   |
| MiniSearch | 173                                  | 165                                   |
| Fuse       | 189                                  | 188                                   |
| Orama      | 121                                  | 143                                   |
| FlexSearch | 50                                   | 51                                    |
| fuzzysort  | 48                                   | 53                                    |
| uFuzzy     | 90                                   | 91                                    |

## Build time and retained heap

| Library    | Build ms, 10,000 records | Heap MB, 10,000 records | Build ms, 100,000 records | Heap MB, 100,000 records |
| ---------- | ------------------------ | ----------------------- | ------------------------- | ------------------------ |
| typoseek   | 135                      | 28.2                    | 867                       | 118.5                    |
| MiniSearch | 66                       | 21.0                    | 1,057                     | 104.2                    |
| Fuse       | 37                       | 13.7                    | 394                       | 127.7                    |
| Orama      | 113                      | 37.8                    | 1,507                     | 243.3                    |
| FlexSearch | 182                      | 60.0                    | 2,104                     | 256.2                    |
| fuzzysort  | 0.03                     | 0.1                     | 0.12                      | 0.8                      |
| uFuzzy     | 3                        | 1.5                     | 28                        | 15.6                     |

At 100,000 records typoseek retains 118.5 MB of heap; the median of the six other libraries is 116.0 MB. typoseek also keeps 1.1 MB in array buffers (its record token streams), which `heapUsed` does not count; the other libraries keep none.

## Async indexing

While `addAllAsync` indexes 100,000 records, a self-rescheduling `setTimeout(0)` probe records the gaps between its callbacks. A gap in which the index grew held a commit slice, one before the first commit a preparation slice. A second run is aborted at 50,000 committed records; a gap in which the index shrank held a rollback slice.

| Slice       | Longest gap ms |
| ----------- | -------------- |
| Preparation | 31.6           |
| Commit      | 49.9           |
| Rollback    | 32.7           |

## Library settings

Each library runs with the settings closest to typoseek's defaults that it offers:

- typoseek: defaults, so all terms must match, 1 typo (optimal string alignment) from 4 and 2 typos from 8 code points, prefix and infix on the last term, diacritic folding, highlights, limit 20.
- MiniSearch: `combineWith: 'AND'`, fuzzy 1 edit (Levenshtein) from 4 and 2 edits from 8 letters, prefix on the last term, `processTerm` set to typoseek's `foldTerm`, first 20 results.
- Fuse: `useTokenSearch` with `tokenMatch: 'all'`, `threshold: 0.25` (1 error per 4 letters), `ignoreLocation`, `ignoreDiacritics`, limit 20.
- Orama: `threshold: 0` (all terms), `tolerance` per query set to the largest typo budget of its terms (1 from 4, 2 from 8 letters), default prefix matching and diacritic replacement, limit 20.
- FlexSearch: a `Document` over one field joining title, body and tag, because FlexSearch matches all query terms within one field; `tokenize: 'forward'` (prefix), encoder `LatinBalance` (diacritic and phonetic normalization, no edit distance), limit 20.
- fuzzysort: a snapshot of the three keys, subsequence matching per space-separated term (no edit distance), default threshold, limit 20.
- uFuzzy: `intraMode` SingleError (1 insertion, substitution, transposition or deletion per term), terms in any order (up to 3 permuted), latinized haystack and needle, first 20 ranked results.

## Run it

```bash
npm ci
npm run bench
```

The script builds `dist/`, prints these tables and writes a new JSON file to `bench/results/`. Latency depends on the machine; compare libraries within one run.
