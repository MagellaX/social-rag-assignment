import os from "node:os";
import path from "node:path";
import { createApp } from "../src/server/app";

process.env.DATA_DIR ??= path.join(os.tmpdir(), "social-rag-data");
process.env.UPLOAD_DIR ??= path.join(os.tmpdir(), "social-rag-uploads");
process.env.TRANSFORMERS_CACHE ??= path.join(os.tmpdir(), "social-rag-model-cache");

const appPromise = createApp({
  dataDir: process.env.DATA_DIR,
  uploadDir: process.env.UPLOAD_DIR
});

export default async function handler(req: RewriteRequest, res: unknown) {
  const app = await appPromise;
  const rewrittenPath = req.query?.path;
  const pathParts = Array.isArray(rewrittenPath) ? rewrittenPath : rewrittenPath ? [rewrittenPath] : [];
  const queryString = req.url?.includes("?") ? `?${req.url.split("?").slice(1).join("?")}` : "";

  req.url = `/api/${pathParts.join("/")}${queryString}`;
  app(req as never, res as never);
}

interface RewriteRequest {
  query?: Record<string, string | string[]>;
  url?: string;
}
