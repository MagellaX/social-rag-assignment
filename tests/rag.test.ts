import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ingestFiles } from "../src/server/ingestion";
import { answerQuestion } from "../src/server/rag";
import type { SourceFile } from "../src/server/types";
import { VectorStore } from "../src/server/vectorStore";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let tempDir: string | undefined;

process.env.EMBEDDING_PROVIDER = "hashing";

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("rag pipeline", () => {
  it("handles greetings without retrieving unrelated evidence", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "social-rag-"));
    const store = new VectorStore(path.join(tempDir, "store.json"));
    const answer = await answerQuestion("hey", store);

    expect(answer.citations).toEqual([]);
    expect(answer.answer).toContain("Ask me about");
  });

  it("ingests incrementally and answers with citations", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "social-rag-"));
    const store = new VectorStore(path.join(tempDir, "store.json"));
    const files: SourceFile[] = [
      "samples/linkedin/Shares.csv",
      "samples/twitter/tweet.js",
      "samples/instagram/posts_1.json"
    ].map((relative) => ({
      path: path.join(rootDir, relative),
      originalName: relative
    }));

    const first = await ingestFiles(files, store, { personId: "sample", displayName: "Sample" });
    const second = await ingestFiles(files, store, { personId: "sample", displayName: "Sample" });
    const answer = await answerQuestion("What does this person think about remote work?", store, {
      personId: "sample"
    });
    const documents = await store.listDocuments({ q: "remote", limit: 10 });

    expect(first.chunksInserted).toBeGreaterThan(0);
    expect(second.chunksInserted).toBe(0);
    expect(second.chunksSkippedAsDuplicates).toBeGreaterThan(0);
    expect(answer.citations.length).toBeGreaterThan(0);
    expect(answer.citations[0].vectorScore).toBeTypeOf("number");
    expect(answer.citations.some((citation) => citation.matchedTerms?.includes("remote"))).toBe(true);
    expect(answer.answer).toContain("[");
    expect(documents.length).toBeGreaterThan(0);
    expect(documents[0].chunkCount).toBeGreaterThan(0);
  });
});
