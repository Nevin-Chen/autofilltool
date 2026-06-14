export const EXEMPLAR_SIM_THRESHOLD = 0.18 as const;
export const FAVORITE_SCORE_BOOST = 0.05 as const;

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'do',
  'for',
  'from',
  'have',
  'in',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'our',
  'that',
  'the',
  'this',
  'to',
  'was',
  'were',
  'will',
  'with',
  'you',
  'your',
]);

export function normalize(s: string): string[] {
  if (!s) return [];
  const lower = s.toLowerCase();
  const cleaned = lower.replace(/[^a-z0-9]+/g, ' ');
  const tokens: string[] = [];
  for (const tok of cleaned.split(/\s+/)) {
    if (tok.length < 3) continue;
    if (STOPWORDS.has(tok)) continue;
    tokens.push(tok);
  }
  return tokens;
}

export function scoreExemplar(
  currentQuestion: string,
  savedQuestion: string,
  isFavorite: boolean = false,
): number {
  const a = new Set(normalize(currentQuestion));
  const b = new Set(normalize(savedQuestion));
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const tok of a) {
    if (b.has(tok)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  if (union === 0) return 0;
  const jaccard = intersection / union;
  return isFavorite ? jaccard + FAVORITE_SCORE_BOOST : jaccard;
}
