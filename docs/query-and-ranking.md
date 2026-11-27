# Query syntax and ranking

## Query syntax

- Words are tokenized like the records. All must match in `'and'` mode, one in `'or'` mode.
- `"exact phrase"` matches the terms adjacent and in order within one value. Stop words inside a phrase match any token at their position.
- `-term` and `-"exact phrase"` exclude records that hold that exact term or phrase.
- The last token of the query matches by prefix when `prefix` is on and inside words when `infix` is on, with the conditions below.
- A query with no clauses left (empty, whitespace, only stop words) returns every record in original order, then filter, sort and pagination apply.

Prefix and infix apply to the last token of the query as the tokenizer reads it, stop words included. A query that ends in a stop word, such as `cat the` with `the` a stop word, gets no prefix or infix clause for any term. A query that ends in a negated term or a phrase gets neither either.

Infix has these conditions:

- The last token must be a positive term of at least 3 code points.
- It matches, without typos, every indexed term that contains it after the term's first code point (`amp` finds `lamp`).
- It ranks below exact and prefix matches and above every match with a typo.
- Terms longer than 64 code points (counted on the folded term) have no infix entries, so infix does not find them. Exact, prefix and typo matching still reach them.

## Ranking

Hits are ordered by these keys, each used only to break a tie in the keys before it:

1. More matched query clauses first.
2. Lower typo cost first. A typo in the first letter counts 2.
3. Fewer infix matches first.
4. Fewer prefix matches first.
5. Higher BM25 style score first. A key's `weight` multiplies the term frequency of that key before saturation, so with equal field lengths relative to the key's average, a match in a weight 2 key ranks above the same match in a weight 1 key.
6. Original order: the order of first `add`. `update` keeps the position, `remove` then `add` moves the record to the end.

`sortBy` replaces all of these except the original order for ties.

`hit.matches` lists, per key path and value, the highlight `ranges`: whole-token `[start, end)` UTF-16 offsets into the original value. `key` is the path as given in `keys` (an empty string for one-shot string items) and `valueIndex` is the position among the values that path resolves to, nested arrays flattened depth first. A number is searched and highlighted as `String(value)`.

Terms are folded with `foldTerm`: ASCII lowercases directly, other text is decomposed (NFKD), combining marks are removed, the result is decomposed again (removing U+034F leaves marks out of canonical order, so a second NFKD pass restores them), lowercased, and then `ß`, `æ`, `œ`, `ø`, `đ`, `ł`, `ı`, `ς`, `þ`, typographic quotes and dashes are mapped to their plain forms.
