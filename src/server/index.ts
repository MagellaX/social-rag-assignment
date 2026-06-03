import cors from "cors";
import express from "express";
import multer from "multer";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEmbedder } from "./embeddings";
import { ingestFiles } from "./ingestion";
import { answerQuestion } from "./rag";
import type { SourceFile } from "./types";
import { VectorStore } from "./vectorStore";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dataDir = process.env.DATA_DIR ?? path.join(rootDir, "data");
const uploadDir = process.env.UPLOAD_DIR ?? path.join(rootDir, "uploads");

await mkdir(uploadDir, { recursive: true });

const app = express();
const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: Number(process.env.MAX_UPLOAD_BYTES ?? 250 * 1024 * 1024),
    files: 30
  }
});
const store = new VectorStore(path.join(dataDir, "vector-store.json"));

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/stats", async (_req, res, next) => {
  try {
    const stats = await store.stats();
    const embedder = createEmbedder();
    res.json({
      ...stats,
      activeEmbeddingModel: embedder.model,
      activeEmbeddingDimensions: embedder.dimensions,
      needsReindex: stats.chunks > 0 && (stats.embeddingModels[embedder.model] ?? 0) !== stats.chunks
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/reindex", async (req, res, next) => {
  try {
    res.json(await store.rebuildEmbeddings(createEmbedder(), { force: Boolean(req.body?.force) }));
  } catch (error) {
    next(error);
  }
});

app.get("/api/documents", async (req, res, next) => {
  try {
    const platform = typeof req.query.platform === "string" && req.query.platform ? req.query.platform : undefined;
    const q = typeof req.query.q === "string" && req.query.q ? req.query.q : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json(await store.listDocuments({ platform, q, limit }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/ingest", upload.array("files"), async (req, res, next) => {
  try {
    const files = ((req.files as Express.Multer.File[]) ?? []).map<SourceFile>((file) => ({
      path: file.path,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      cleanup: true
    }));

    if (!files.length) {
      res.status(400).json({ error: "Upload one or more export files under the files field." });
      return;
    }

    const displayName = String(req.body.displayName ?? "Imported person").trim();
    const personId = slug(String(req.body.personId ?? (displayName || "default")));
    res.json(await ingestFiles(files, store, { personId, displayName }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/chat", async (req, res, next) => {
  try {
    const question = String(req.body.question ?? "").trim();
    if (!question) {
      res.status(400).json({ error: "question is required" });
      return;
    }
    res.json(
      await answerQuestion(question, store, {
        personId: req.body.personId,
        k: req.body.k,
        platform: req.body.platform,
        mode: req.body.mode
      })
    );
  } catch (error) {
    next(error);
  }
});

const distDir = path.join(rootDir, "dist");
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  res.status(500).json({ error: message });
});

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
app.listen(port, host, () => {
  console.log(`API listening on http://${host}:${port}`);
});

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "default"
  );
}
