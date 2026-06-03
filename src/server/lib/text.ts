const URL_RE = /^https?:\/\/\S+$/i;
const WHITESPACE_RE = /\s+/g;

export function normalizeText(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(WHITESPACE_RE, " ")
    .trim();
}

export function meaningfulText(text: string): boolean {
  const normalized = normalizeText(text);
  if (normalized.length < 3) return false;
  if (URL_RE.test(normalized)) return false;
  const alphaCount = (normalized.match(/[A-Za-z0-9]/g) ?? []).length;
  return alphaCount >= 3;
}

export function tokenize(text: string): string[] {
  return normalizeText(text)
    .toLowerCase()
    .split(/[^a-z0-9#@']+/i)
    .map((token) => token.replace(/^'+|'+$/g, ""))
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export function estimateTokens(text: string): number {
  return Math.max(1, tokenize(text).length);
}

export function splitSentences(text: string): string[] {
  const cleaned = normalizeText(text);
  if (!cleaned) return [];
  return cleaned
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\r?\n{2,}/)
    .map(normalizeText)
    .filter(Boolean);
}

export function excerpt(text: string, max = 260): string {
  const normalized = normalizeText(text);
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trimEnd()}...`;
}

export function field(row: Record<string, unknown>, candidates: string[]): string | undefined {
  const normalizedKeys = new Map<string, string>();
  for (const key of Object.keys(row)) {
    normalizedKeys.set(normalizeKey(key), key);
  }

  for (const candidate of candidates) {
    const sourceKey = normalizedKeys.get(normalizeKey(candidate));
    if (!sourceKey) continue;
    const value = row[sourceKey];
    if (typeof value === "string" && normalizeText(value)) return normalizeText(value);
    if (value !== undefined && value !== null && String(value).trim()) return normalizeText(String(value));
  }

  return undefined;
}

export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "did",
  "do",
  "does",
  "for",
  "from",
  "has",
  "have",
  "if",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "people",
  "person",
  "that",
  "the",
  "this",
  "think",
  "thinks",
  "thought",
  "to",
  "was",
  "what",
  "were",
  "with"
]);
