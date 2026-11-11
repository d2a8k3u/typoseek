const BM25_K1 = 1.2;
const BM25_B = 0.75;

export interface RankKey {
  readonly matchedClauses: number;
  readonly typoCost: number;
  readonly infixMatches: number;
  readonly prefixMatches: number;
  readonly score: number;
  readonly docNum: number;
}

export function idf(recordCount: number, documentFrequency: number): number {
  return Math.log(1 + (recordCount - documentFrequency + 0.5) / (documentFrequency + 0.5));
}

export function weightedFieldFrequency(
  tf: number,
  fieldLength: number,
  averageFieldLength: number,
  weight: number,
): number {
  return (weight * tf) / (1 - BM25_B + (BM25_B * fieldLength) / averageFieldLength);
}

export function termContribution(weightedFrequency: number): number {
  return (weightedFrequency * (BM25_K1 + 1)) / (weightedFrequency + BM25_K1);
}

export function compareRelevance(a: RankKey, b: RankKey): number {
  return (
    b.matchedClauses - a.matchedClauses ||
    a.typoCost - b.typoCost ||
    a.infixMatches - b.infixMatches ||
    a.prefixMatches - b.prefixMatches ||
    b.score - a.score ||
    a.docNum - b.docNum
  );
}
