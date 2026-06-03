import { createReadStream } from "node:fs";
import { readFileSync } from "node:fs";
import { parse } from "csv-parse";
import { field, meaningfulText, normalizeKey, normalizeText } from "../lib/text";
import type { ParsedItem, SourceFile } from "../types";
import { extensionOf, type SourceParser } from "./base";

const TEXT_FIELDS = [
  "ShareCommentary",
  "Share Commentary",
  "Commentary",
  "Text",
  "Content",
  "Body",
  "Message",
  "Post",
  "Description",
  "Comment",
  "Summary",
  "Headline",
  "Title"
];

const DATE_FIELDS = ["Date", "Created Date", "Created At", "Posted Date", "Time", "Timestamp"];
const URL_FIELDS = ["URL", "Url", "Link", "Shared URL", "Shared Url", "Permalink"];

export class LinkedInParser implements SourceParser {
  platform = "linkedin" as const;

  canParse(file: SourceFile): boolean {
    const name = file.originalName.toLowerCase();
    return (
      extensionOf(name) === "csv" &&
      (name.includes("linkedin") || looksLikeLinkedInCsv(name) || csvHeaderLooksLikeLinkedIn(file.path))
    );
  }

  async *parse(file: SourceFile): AsyncIterable<ParsedItem> {
    const parser = parse({
      bom: true,
      columns: true,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true
    });

    createReadStream(file.path).pipe(parser);

    for await (const row of parser as AsyncIterable<Record<string, string>>) {
      const item = rowToItem(row, file.originalName);
      if (item) yield item;
    }
  }
}

function rowToItem(row: Record<string, string>, fileName: string): ParsedItem | undefined {
  const lowerName = fileName.toLowerCase();
  const kind = lowerName.includes("profile")
    ? "profile"
    : lowerName.includes("comment")
      ? "comment"
      : "post";

  if (kind === "profile") {
    const fullName = [field(row, ["First Name", "FirstName"]), field(row, ["Last Name", "LastName"])]
      .filter(Boolean)
      .join(" ");
    const headline = field(row, ["Headline", "Title", "Position"]);
    const summary = field(row, ["Summary", "About", "Description"]);
    const location = field(row, ["Location", "Geo Location"]);
    const industry = field(row, ["Industry"]);
    const profileText = [
      fullName && `Name: ${fullName}`,
      headline && `Headline: ${headline}`,
      summary && `About: ${summary}`,
      industry && `Industry: ${industry}`,
      location && `Location: ${location}`
    ]
      .filter(Boolean)
      .join(". ");

    if (!meaningfulText(profileText)) return undefined;
    return {
      platform: "linkedin",
      kind: "profile",
      text: profileText,
      externalId: fullName || headline || "profile",
      title: fullName || "LinkedIn profile",
      metadata: compactObject({ industry, location })
    };
  }

  const text = field(row, TEXT_FIELDS);
  if (!text || !meaningfulText(text)) return undefined;
  const authoredAt = field(row, DATE_FIELDS);
  const uri = field(row, URL_FIELDS);
  const externalId = field(row, ["ID", "Share ID", "Activity ID", "Urn"]) ?? `${authoredAt ?? ""}:${text}`;

  return {
    platform: "linkedin",
    kind,
    text: normalizeText(text),
    externalId,
    authoredAt,
    uri,
    title: kind === "comment" ? "LinkedIn comment" : "LinkedIn post",
    metadata: compactObject({
      visibility: field(row, ["Visibility"]),
      originalAuthor: field(row, ["Author", "From"])
    })
  };
}

function looksLikeLinkedInCsv(name: string): boolean {
  return ["profile", "shares", "posts", "comments", "reactions"].some((part) => name.includes(part));
}

function csvHeaderLooksLikeLinkedIn(filePath: string): boolean {
  try {
    const firstLine = readFileSync(filePath, "utf8").slice(0, 4096).split(/\r?\n/)[0] ?? "";
    return hasLinkedInHeaders(firstLine.split(",").map((header) => header.trim().replace(/^"|"$/g, "")));
  } catch {
    return false;
  }
}

function compactObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== ""));
}

export function hasLinkedInHeaders(headers: string[]): boolean {
  const normalized = new Set(headers.map(normalizeKey));
  return ["sharecommentary", "firstname", "lastname", "headline"].some((key) => normalized.has(key));
}
