import os from "node:os";
import path from "node:path";
import { createApp } from "../src/server/app";

process.env.DATA_DIR ??= path.join(os.tmpdir(), "social-rag-data");
process.env.UPLOAD_DIR ??= path.join(os.tmpdir(), "social-rag-uploads");
process.env.TRANSFORMERS_CACHE ??= path.join(os.tmpdir(), "social-rag-model-cache");

const app = await createApp({
  dataDir: process.env.DATA_DIR,
  uploadDir: process.env.UPLOAD_DIR
});

export default app;
