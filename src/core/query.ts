export interface QueryClause {
  readonly kind: 'term' | 'phrase';
  readonly negated: boolean;
  readonly text: string;
}

interface ScannedClause {
  readonly kind: QueryClause['kind'];
  readonly text: string;
  readonly next: number;
}

const WHITESPACE = /\s/u;

const NEGATION_MARKS: ReadonlySet<string> = new Set(['-', '−']);

const PHRASE_QUOTES: ReadonlySet<string> = new Set(['"', '“', '”', '„', '‟', '«', '»']);

function isWhitespace(character: string): boolean {
  return WHITESPACE.test(character);
}

function isPhraseQuote(character: string): boolean {
  return PHRASE_QUOTES.has(character);
}

function scanPhrase(query: string, textStart: number): ScannedClause {
  let end = textStart;
  while (end < query.length && !isPhraseQuote(query.charAt(end))) {
    end += 1;
  }
  return { kind: 'phrase', text: query.slice(textStart, end), next: end + 1 };
}

function scanTerm(query: string, start: number): ScannedClause {
  let end = start;
  while (end < query.length && !isWhitespace(query.charAt(end)) && !isPhraseQuote(query.charAt(end))) {
    end += 1;
  }
  return { kind: 'term', text: query.slice(start, end), next: end };
}

function scanClause(query: string, start: number): ScannedClause {
  return isPhraseQuote(query.charAt(start)) ? scanPhrase(query, start + 1) : scanTerm(query, start);
}

export function parseQuery(query: string): readonly QueryClause[] {
  const clauses: QueryClause[] = [];
  let cursor = 0;
  while (cursor < query.length) {
    const character = query.charAt(cursor);
    if (isWhitespace(character)) {
      cursor += 1;
      continue;
    }
    const negated = NEGATION_MARKS.has(character);
    const { kind, text, next } = scanClause(query, negated ? cursor + 1 : cursor);
    if (text !== '') {
      clauses.push({ kind, negated, text });
    }
    cursor = next;
  }
  return clauses;
}
