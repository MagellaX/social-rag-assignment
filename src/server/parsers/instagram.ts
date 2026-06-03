import { readFile } from "node:fs/promises";
import * as cheerio from "cheerio";
import { field, meaningfulText, normalizeText } from "../lib/text";
import type { ParsedItem, SourceFile } from "../types";
import { extensionOf, parseJsonish, type SourceParser } from "./base";

export class InstagramParser implements SourceParser {
  platform = "instagram" as const;

  canParse(file: SourceFile): boolean {
    const name = file.originalName.toLowerCase();
    const ext = extensionOf(name);
    return (
      (ext === "json" || ext === "html" || ext === "htm") &&
      (name.includes("instagram") ||
        name.includes("posts") ||
        name.includes("media") ||
        name.includes("personal_information"))
    );
  }

  async *parse(file: SourceFile): AsyncIterable<ParsedItem> {
    const ext = extensionOf(file.originalName);
    const raw = await readFile(file.path, "utf8");
    if (ext === "html" || ext === "htm") {
      yield* parseHtml(raw);
      return;
    }
    yield* extractInstagramItems(parseJsonish(raw));
  }
}

function* extractInstagramItems(data: unknown): Iterable<ParsedItem> {
  if (Array.isArray(data)) {
    for (const entry of data) yield* extractInstagramItems(entry);
    return;
  }

  if (!isRecord(data)) return;

  if (Array.isArray(data.media)) {
    for (const entry of data.media) yield* extractInstagramItems(entry);
  }

  const caption = getStringMapValue(data, "Caption") ?? field(data, ["title", "caption"]);
  if (caption && meaningfulText(caption)) {
    yield {
      platform: "instagram",
      kind: "caption",
      text: normalizeText(caption),
      externalId: field(data, ["uri", "media_id", "id"]) ?? caption,
      authoredAt: timestampToIso(field(data, ["creation_timestamp", "taken_at_timestamp", "timestamp"])),
      uri: field(data, ["uri", "href"]),
      title: "Instagram caption",
      metadata: {
        mediaPath: field(data, ["uri"])
      }
    };
  }

  const bio = getStringMapValue(data, "Bio") ?? field(data, ["bio", "biography"]);
  const name = getStringMapValue(data, "Name") ?? field(data, ["name", "username"]);
  if (bio || name) {
    const text = [name && `Name: ${name}`, bio && `Bio: ${bio}`].filter(Boolean).join(". ");
    if (meaningfulText(text)) {
      yield {
        platform: "instagram",
        kind: "profile",
        text,
        externalId: field(data, ["username"]) ?? name ?? "profile",
        title: name ?? "Instagram profile",
        metadata: {}
      };
    }
  }

  for (const [key, value] of Object.entries(data)) {
    if (key === "media") continue;
    if (Array.isArray(value) || isRecord(value)) yield* extractInstagramItems(value);
  }
}

function* parseHtml(raw: string): Iterable<ParsedItem> {
  const $ = cheerio.load(raw);
  $("script, style, noscript, svg").remove();

  const profileText = normalizeText($("header, .profile, #profile").first().text());
  if (meaningfulText(profileText)) {
    yield {
      platform: "instagram",
      kind: "profile",
      text: profileText,
      externalId: "html-profile",
      title: "Instagram profile",
      metadata: { format: "html" }
    };
  }

  const candidates = $("article, main li, .post, .media");
  for (const element of candidates.toArray()) {
    const text = normalizeText($(element).text());
    if (!meaningfulText(text)) continue;
    yield {
      platform: "instagram",
      kind: "caption",
      text,
      externalId: text,
      title: "Instagram HTML post",
      metadata: { format: "html" }
    };
  }
}

function getStringMapValue(data: Record<string, unknown>, label: string): string | undefined {
  const stringMapData = data.string_map_data;
  if (!isRecord(stringMapData)) return undefined;
  const entry = stringMapData[label];
  if (!isRecord(entry)) return undefined;
  return field(entry, ["value"]);
}

function timestampToIso(value?: string): string | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  const date = new Date(numeric > 2_000_000_000 ? numeric : numeric * 1000);
  return date.toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
