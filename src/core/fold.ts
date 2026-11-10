const NON_ASCII = /\P{ASCII}/u;

const REMOVED_COMBINING_MARKS = /[̀-ͯ]|[᪰-᫿]|[᷀-᷿]|[⃐-⃿]|[︠-︯]/gu;

const FOLDS_LEFT_BY_DECOMPOSITION: ReadonlyMap<string, string> = new Map([
  ['ß', 'ss'],
  ['æ', 'ae'],
  ['œ', 'oe'],
  ['ø', 'o'],
  ['đ', 'd'],
  ['ł', 'l'],
  ['ı', 'i'],
  ['ς', 'σ'],
  ['þ', 'th'],
  ['‘', "'"],
  ['’', "'"],
  ['‚', "'"],
  ['‛', "'"],
  ['′', "'"],
  ['“', '"'],
  ['”', '"'],
  ['„', '"'],
  ['‟', '"'],
  ['«', '"'],
  ['»', '"'],
  ['‐', '-'],
  ['‒', '-'],
  ['–', '-'],
  ['—', '-'],
  ['―', '-'],
  ['−', '-'],
]);

function removeMarksKeepingCanonicalOrder(decomposed: string): string {
  return decomposed.replace(REMOVED_COMBINING_MARKS, '').normalize('NFKD');
}

function foldCharacter(character: string): string {
  return FOLDS_LEFT_BY_DECOMPOSITION.get(character) ?? character;
}

/** @public */
export function foldTerm(term: string): string {
  if (!NON_ASCII.test(term)) {
    return term.toLowerCase();
  }
  const unmarked = removeMarksKeepingCanonicalOrder(term.normalize('NFKD'));
  return Array.from(unmarked.toLowerCase(), foldCharacter).join('');
}
