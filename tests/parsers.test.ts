import path from "node:path";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { InstagramParser } from "../src/server/parsers/instagram";
import { LinkedInParser } from "../src/server/parsers/linkedin";
import { TwitterParser } from "../src/server/parsers/twitter";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("source parsers", () => {
  it("extracts LinkedIn profile and posts from CSV", async () => {
    const parser = new LinkedInParser();
    const items = await collect(
      parser.parse({
        path: path.join(rootDir, "samples/linkedin/Shares.csv"),
        originalName: "Shares.csv"
      })
    );

    expect(items).toHaveLength(2);
    expect(items[0].platform).toBe("linkedin");
    expect(items[0].text.toLowerCase()).toContain("remote teams");
  });

  it("recognizes LinkedIn-shaped CSV headers even with a generic filename", () => {
    const parser = new LinkedInParser();

    expect(
      parser.canParse({
        path: path.join(rootDir, "samples/linkedin/Shares.csv"),
        originalName: "generic-export.csv"
      })
    ).toBe(true);
  });

  it("extracts authored Twitter/X posts and skips retweets", async () => {
    const parser = new TwitterParser();
    const items = await collect(
      parser.parse({
        path: path.join(rootDir, "samples/twitter/tweet.js"),
        originalName: "tweet.js"
      })
    );

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.text).join(" ")).not.toContain("RT @");
  });

  it("extracts Instagram captions from JSON", async () => {
    const parser = new InstagramParser();
    const items = await collect(
      parser.parse({
        path: path.join(rootDir, "samples/instagram/posts_1.json"),
        originalName: "posts_1.json"
      })
    );

    expect(items).toHaveLength(2);
    expect(items[0].kind).toBe("caption");
  });
});

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}
