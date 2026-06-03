import type { ParsedItem, SourceFile } from "../types";

export interface SourceParser {
  platform: ParsedItem["platform"];
  canParse(file: SourceFile): boolean;
  parse(file: SourceFile): AsyncIterable<ParsedItem>;
}

export function extensionOf(fileName: string): string {
  const match = /\.([^.]+)$/.exec(fileName.toLowerCase());
  return match ? match[1] : "";
}

export function stripJsonAssignment(raw: string): string {
  const trimmed = raw.trim();
  const firstBrace = trimmed.indexOf("{");
  const firstBracket = trimmed.indexOf("[");
  const starts = [firstBrace, firstBracket].filter((index) => index >= 0);
  const start = Math.min(...starts);
  if (!Number.isFinite(start)) return trimmed;
  return trimmed.slice(start).replace(/;\s*$/g, "");
}

export function parseJsonish(raw: string): unknown {
  return JSON.parse(stripJsonAssignment(raw));
}
