import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { createApp, rootDir } from "./app";

const app = await createApp();

const distDir = path.join(rootDir, "dist");
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(distDir, "index.html"));
  });
}

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
app.listen(port, host, () => {
  console.log(`API listening on http://${host}:${port}`);
});
