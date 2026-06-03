import { readFile } from "node:fs/promises";
import { field, meaningfulText, normalizeText } from "../lib/text";
import type { ParsedItem, SourceFile } from "../types";
import { extensionOf, parseJsonish, type SourceParser } from "./base";

export class TwitterParser implements SourceParser {
  platform = "twitter" as const;

  canParse(file: SourceFile): boolean {
    const name = file.originalName.toLowerCase();
    const ext = extensionOf(name);
    return (ext === "json" || ext === "js") && (name.includes("twitter") || name.includes("tweet") || name.includes("x-"));
  }

  async *parse(file: SourceFile): AsyncIterable<ParsedItem> {
    const data = parseJsonish(await readFile(file.path, "utf8"));
    for (const item of extractTwitterItems(data)) {
      yield item;
    }
  }
}

function* extractTwitterItems(data: unknown): Iterable<ParsedItem> {
  if (Array.isArray(data)) {
    for (const entry of data) {
      yield* extractTwitterItems(entry);
    }
    return;
  }

  if (!isRecord(data)) return;

  if (isRecord(data.tweet)) {
    const tweet = data.tweet;
    const fullText = field(tweet, ["full_text", "fullText", "text"]);
    if (fullText && meaningfulText(fullText) && !fullText.startsWith("RT @")) {
      const id = field(tweet, ["id_str", "id"]);
      const screenName = field(tweet, ["screen_name", "screenName", "userName"]);
      yield {
        platform: "twitter",
        kind: "post",
        text: normalizeText(fullText),
        externalId: id,
        authoredAt: field(tweet, ["created_at", "createdAt"]),
        uri: id && screenName ? `https://twitter.com/${screenName}/status/${id}` : undefined,
        title: "Twitter/X post",
        metadata: {
          favoriteCount: field(tweet, ["favorite_count"]),
          retweetCount: field(tweet, ["retweet_count"])
        }
      };
    }
    return;
  }

  if (isRecord(data.profile)) {
    yield* extractProfile(data.profile);
    return;
  }

  if (isRecord(data.account)) {
    yield* extractProfile(data.account);
    return;
  }

  if (looksLikeProfile(data)) {
    yield* extractProfile(data);
    return;
  }

  for (const value of Object.values(data)) {
    if (Array.isArray(value) || isRecord(value)) yield* extractTwitterItems(value);
  }
}

function* extractProfile(profile: Record<string, unknown>): Iterable<ParsedItem> {
  const nested = isRecord(profile.description) ? profile.description : profile;
  const name = field(profile, ["displayName", "accountDisplayName", "name"]);
  const username = field(profile, ["username", "screenName", "accountId"]);
  const bio = field(nested, ["bio", "description", "value"]);
  const location = field(profile, ["location"]);
  const text = [
    name && `Name: ${name}`,
    username && `Username: ${username}`,
    bio && `Bio: ${bio}`,
    location && `Location: ${location}`
  ]
    .filter(Boolean)
    .join(". ");

  if (!meaningfulText(text)) return;

  yield {
    platform: "twitter",
    kind: "profile",
    text,
    externalId: username ?? name ?? "profile",
    title: name ?? "Twitter/X profile",
    uri: username ? `https://twitter.com/${username.replace(/^@/, "")}` : undefined,
    metadata: { location }
  };
}

function looksLikeProfile(data: Record<string, unknown>): boolean {
  return Boolean(field(data, ["username", "screenName", "displayName", "bio", "description"]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
