import path from "node:path";
import { fileURLToPath } from "node:url";
import { ingestFiles } from "../src/server/ingestion";
import type { SourceFile } from "../src/server/types";
import { VectorStore } from "../src/server/vectorStore";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files: SourceFile[] = [
  "samples/linkedin/Profile.csv",
  "samples/linkedin/Shares.csv",
  "samples/twitter/tweet.js",
  "samples/instagram/posts_1.json"
].map((relative) => ({
  path: path.join(rootDir, relative),
  originalName: relative
}));

const store = new VectorStore(path.join(rootDir, "data", "vector-store.json"));
const result = await ingestFiles(files, store, {
  personId: "sample-person",
  displayName: "Sample Person"
});

console.log(JSON.stringify(result, null, 2));
