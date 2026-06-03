require("tsx/cjs");

const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../src/server/app.ts");

process.env.DATA_DIR ??= path.join(os.tmpdir(), "social-rag-data");
process.env.UPLOAD_DIR ??= path.join(os.tmpdir(), "social-rag-uploads");
process.env.TRANSFORMERS_CACHE ??= path.join(os.tmpdir(), "social-rag-model-cache");

const appPromise = createApp({
  dataDir: process.env.DATA_DIR,
  uploadDir: process.env.UPLOAD_DIR
});

module.exports = async function handler(req, res) {
  const app = await appPromise;
  const rewrittenPath = req.query?.path;
  const pathParts = Array.isArray(rewrittenPath) ? rewrittenPath : rewrittenPath ? [rewrittenPath] : [];
  const queryString = req.url?.includes("?") ? `?${req.url.split("?").slice(1).join("?")}` : "";

  req.url = `/api/${pathParts.join("/")}${queryString}`;
  app(req, res);
};
