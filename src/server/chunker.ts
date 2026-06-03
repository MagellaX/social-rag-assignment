import { shortHash } from "./lib/hash";
import { estimateTokens, normalizeText, splitParagraphs, splitSentences, tokenize } from "./lib/text";
import type { Chunk, ParsedDocument, ParsedItem, SourceFile } from "./types";

const TARGET_TOKENS = 180;
const MAX_TOKENS = 260;
const OVERLAP_SENTENCES = 1;

export function itemToDocument(item: ParsedItem, file: SourceFile, personId: string): ParsedDocument {
  const now = new Date().toISOString();
  const stable = [
    item.platform,
    item.kind,
    item.externalId ?? "",
    item.authoredAt ?? "",
    normalizeText(item.text)
  ].join("|");
  const contentHash = shortHash(stable, 24);

  return {
    id: `${item.platform}_${contentHash}`,
    personId,
    platform: item.platform,
    kind: item.kind,
    title: item.title ?? `${item.platform} ${item.kind}`,
    text: normalizeText(item.text),
    externalId: item.externalId,
    authoredAt: item.authoredAt,
    uri: item.uri,
    sourceFile: file.originalName,
    contentHash,
    metadata: item.metadata ?? {},
    createdAt: now,
    updatedAt: now
  };
}

export function chunkDocument(document: ParsedDocument): Chunk[] {
  if (document.kind === "profile") {
    return [makeChunk(document, document.text, 0)];
  }

  const paragraphs = splitParagraphs(document.text);
  const units = paragraphs.length > 1 ? paragraphs.flatMap(splitSentences) : splitSentences(document.text);
  const sentences = units.length ? units : [document.text];

  const chunks: Chunk[] = [];
  let current: string[] = [];
  let currentTokens = 0;
  let ordinal = 0;

  for (const sentence of sentences) {
    const sentenceTokens = estimateTokens(sentence);

    if (sentenceTokens > MAX_TOKENS) {
      if (current.length) {
        chunks.push(makeChunk(document, current.join(" "), ordinal++));
        current = current.slice(-OVERLAP_SENTENCES);
        currentTokens = tokenCount(current);
      }
      for (const split of splitLongSentence(sentence, TARGET_TOKENS)) {
        chunks.push(makeChunk(document, split, ordinal++));
      }
      continue;
    }

    if (currentTokens + sentenceTokens > MAX_TOKENS && current.length) {
      chunks.push(makeChunk(document, current.join(" "), ordinal++));
      current = current.slice(-OVERLAP_SENTENCES);
      currentTokens = tokenCount(current);
    }

    current.push(sentence);
    currentTokens += sentenceTokens;

    if (currentTokens >= TARGET_TOKENS) {
      chunks.push(makeChunk(document, current.join(" "), ordinal++));
      current = current.slice(-OVERLAP_SENTENCES);
      currentTokens = tokenCount(current);
    }
  }

  if (current.length) {
    chunks.push(makeChunk(document, current.join(" "), ordinal));
  }

  return chunks;
}

function makeChunk(document: ParsedDocument, text: string, ordinal: number): Chunk {
  const normalized = normalizeText(text);
  const contentHash = shortHash(`${document.id}|${ordinal}|${normalized}`, 24);

  return {
    id: `chunk_${contentHash}`,
    documentId: document.id,
    personId: document.personId,
    platform: document.platform,
    kind: document.kind,
    text: normalized,
    ordinal,
    tokenCount: estimateTokens(normalized),
    contentHash,
    authoredAt: document.authoredAt,
    uri: document.uri,
    sourceTitle: document.title,
    metadata: {
      ...document.metadata,
      sourceFile: document.sourceFile,
      externalId: document.externalId
    }
  };
}

function tokenCount(parts: string[]): number {
  return parts.reduce((sum, part) => sum + estimateTokens(part), 0);
}

function splitLongSentence(sentence: string, targetTokens: number): string[] {
  const tokens = tokenize(sentence);
  const parts: string[] = [];
  for (let i = 0; i < tokens.length; i += targetTokens) {
    parts.push(tokens.slice(i, i + targetTokens).join(" "));
  }
  return parts;
}
