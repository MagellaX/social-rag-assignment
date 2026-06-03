import cors from "cors";
import express from "express";
import multer from "multer";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEmbedder } from "./embeddings";
import { ingestFiles } from "./ingestion";
import { answerQuestion } from "./rag";
import type { SourceFile } from "./types";
import { VectorStore } from "./vectorStore";

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export async function createApp(options: { dataDir?: string; uploadDir?: string } = {}): Promise<express.Express> {
  const dataDir = options.dataDir ?? process.env.DATA_DIR ?? path.join(rootDir, "data");
  const uploadDir = options.uploadDir ?? process.env.UPLOAD_DIR ?? path.join(rootDir, "uploads");

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

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  });

  return app;
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "default"
  );
}
