import { describe, expect, test } from 'vitest';
import { foldTerm } from '../../../src/core/fold.ts';

describe('foldTerm', () => {
  test.each([
    { left: 'ěščřžýáíé', right: 'escrzyaie', folded: 'escrzyaie' },
    { left: 'Příliš', right: 'prilis', folded: 'prilis' },
    { left: 'ŽLUŤOUČKÝ', right: 'zlutoucky', folded: 'zlutoucky' },
    { left: 'kůň', right: 'kun', folded: 'kun' },
    { left: 'Ďábel', right: 'dabel', folded: 'dabel' },
    { left: 'Café', right: 'cafe', folded: 'cafe' },
    { left: 'garçon', right: 'garcon', folded: 'garcon' },
    { left: 'Noël', right: 'noel', folded: 'noel' },
    { left: 'naïve', right: 'naive', folded: 'naive' },
    { left: 'hôpital', right: 'hopital', folded: 'hopital' },
    { left: 'cœur', right: 'coeur', folded: 'coeur' },
    { left: 'ŒUVRE', right: 'oeuvre', folded: 'oeuvre' },
    { left: 'Straße', right: 'strasse', folded: 'strasse' },
    { left: 'GROẞE', right: 'grosse', folded: 'grosse' },
    { left: 'Müller', right: 'muller', folded: 'muller' },
    { left: 'Äpfel', right: 'apfel', folded: 'apfel' },
    { left: 'İstanbul', right: 'istanbul', folded: 'istanbul' },
    { left: 'ılık', right: 'ilik', folded: 'ilik' },
    { left: 'IŞIK', right: 'isik', folded: 'isik' },
    { left: 'Æsir', right: 'aesir', folded: 'aesir' },
    { left: 'Øresund', right: 'oresund', folded: 'oresund' },
    { left: 'Łódź', right: 'lodz', folded: 'lodz' },
    { left: 'Đorđe', right: 'dorde', folded: 'dorde' },
    { left: 'Þorn', right: 'thorn', folded: 'thorn' },
    { left: 'ΟΔΟΣ', right: 'οδος', folded: 'οδοσ' },
    { left: 'ﬁle', right: 'file', folded: 'file' },
    { left: 'ﬂow', right: 'flow', folded: 'flow' },
    { left: 'ĳs', right: 'ijs', folded: 'ijs' },
    { left: 'ﬆar', right: 'star', folded: 'star' },
    { left: 'ＴＹＰＯ', right: 'TYPO', folded: 'typo' },
    { left: '１２３', right: '123', folded: '123' },
    { left: '𝐀', right: 'a', folded: 'a' },
    { left: 'ℌ', right: 'h', folded: 'h' },
    { left: 'ᴬ', right: 'a', folded: 'a' },
    { left: '㎆', right: 'mb', folded: 'mb' },
    { left: 'İ', right: 'i', folded: 'i' },
    { left: 'don’t', right: "don't", folded: "don't" },
    { left: '‘x’‚‛′', right: "'x''''", folded: "'x''''" },
    { left: '“x”„‟«»', right: '"x"""""', folded: '"x"""""' },
    { left: 'a‐b‒c–d—e―f−g', right: 'a-b-c-d-e-f-g', folded: 'a-b-c-d-e-f-g' },
    { left: 'a‑b﹣c－d', right: 'a-b-c-d', folded: 'a-b-c-d' },
    { left: '″', right: "''", folded: "''" },
    { left: 'àͯ', right: 'a', folded: 'a' },
    { left: 'a᪰᫿', right: 'a', folded: 'a' },
    { left: 'a᷿᷀', right: 'a', folded: 'a' },
    { left: 'a⃐⃿', right: 'a', folded: 'a' },
    { left: 'a︠︯', right: 'a', folded: 'a' },
  ])('folds $left and $right to $folded', ({ left, right, folded }) => {
    expect(foldTerm(left)).toBe(folded);
    expect(foldTerm(right)).toBe(folded);
  });

  test.each([
    ['ดี', 'ดู'],
    ['ไม้', 'ไม'],
    ['ば', 'は'],
    ['ぱ', 'は'],
    ['ば', 'ぱ'],
    ['क्ष', 'कष'],
    ['שָׁלוֹם', 'שלום'],
  ])('keeps marks outside the removed blocks, so %s and %s stay distinct', (left, right) => {
    expect(foldTerm(left)).not.toBe(foldTerm(right));
  });

  test('stays idempotent when a removed mark separated marks in non-canonical order', () => {
    const folded = foldTerm('x֑͏ְ');

    expect(folded).toBe('xְ֑');
    expect(foldTerm(folded)).toBe(folded);
  });
});
