import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fnv1a } from "./lib/hash";
import { sha256 } from "./lib/hash";
import { normalizeText, tokenize } from "./lib/text";

export interface Embedder {
  model: string;
  dimensions: number;
  maxConcurrency?: number;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export class HashingEmbedder implements Embedder {
  model = "local-hashing-v1";
  dimensions: number;

  constructor(dimensions = 384) {
    this.dimensions = dimensions;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((text) => hashingVector(text, this.dimensions));
  }
}

export class OpenAIEmbedder implements Embedder {
  model: string;
  dimensions: number;
  private apiKey: string;

  constructor(options: { apiKey: string; model?: string; dimensions?: number }) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? "text-embedding-3-small";
    this.dimensions = options.dimensions ?? 512;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        dimensions: this.dimensions
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI embeddings failed: ${response.status} ${await response.text()}`);
    }

    const body = (await response.json()) as { data: Array<{ embedding: number[]; index: number }> };
    return body.data.sort((a, b) => a.index - b.index).map((item) => normalizeVector(item.embedding));
  }
}

export class TransformersEmbedder implements Embedder {
  model: string;
  dimensions = 384;
  maxConcurrency = 1;
  private extractorPromise?: Promise<FeatureExtractor>;

  constructor(model = process.env.TRANSFORMERS_EMBEDDING_MODEL ?? "Xenova/all-MiniLM-L6-v2") {
    this.model = `transformers-js:${model}`;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const extractor = await this.loadExtractor();
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    return output.tolist().map((vector) => normalizeVector(vector));
  }

  private async loadExtractor(): Promise<FeatureExtractor> {
    if (!this.extractorPromise) {
      this.extractorPromise = (async () => {
        const transformers = await import("@huggingface/transformers");
        transformers.env.allowLocalModels = true;
        transformers.env.allowRemoteModels = process.env.TRANSFORMERS_ALLOW_REMOTE !== "false";
        transformers.env.cacheDir = process.env.TRANSFORMERS_CACHE ?? path.join(process.cwd(), "data", "model-cache");
        const modelName = this.model.replace(/^transformers-js:/, "");
        return (await transformers.pipeline("feature-extraction", modelName)) as FeatureExtractor;
      })();
    }
    return this.extractorPromise;
  }
}

export class CachingEmbedder implements Embedder {
  model: string;
  dimensions: number;
  maxConcurrency?: number;
  private cache?: EmbeddingCacheFile;

  constructor(
    private readonly base: Embedder,
    private readonly cachePath = process.env.EMBEDDING_CACHE_PATH ?? path.join(process.cwd(), "data", "embedding-cache.json")
  ) {
    this.model = base.model;
    this.dimensions = base.dimensions;
    this.maxConcurrency = base.maxConcurrency;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const cache = await this.loadCache();
    const results = new Array<number[]>(texts.length);
    const misses: Array<{ index: number; text: string; key: string }> = [];

    texts.forEach((text, index) => {
      const key = cacheKey(this.model, text);
      const hit = cache.entries[key];
      if (hit?.dimensions === this.dimensions) {
        results[index] = hit.embedding;
      } else {
        misses.push({ index, text, key });
      }
    });

    if (misses.length) {
      const embeddings = await this.base.embedBatch(misses.map((miss) => miss.text));
      const now = new Date().toISOString();
      misses.forEach((miss, offset) => {
        const embedding = embeddings[offset];
        results[miss.index] = embedding;
        cache.entries[miss.key] = {
          dimensions: this.dimensions,
          embedding,
          insertedAt: now,
          model: this.model
        };
      });
      await this.saveCache();
    }

    return results;
  }

  private async loadCache(): Promise<EmbeddingCacheFile> {
    if (this.cache) return this.cache;
    try {
      this.cache = JSON.parse(await readFile(this.cachePath, "utf8")) as EmbeddingCacheFile;
    } catch {
      this.cache = { version: 1, entries: {} };
    }
    return this.cache;
  }

  private async saveCache(): Promise<void> {
    if (!this.cache) return;
    await mkdir(path.dirname(this.cachePath), { recursive: true });
    const tempPath = `${this.cachePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(this.cache));
    await rename(tempPath, this.cachePath);
  }
}

export function createEmbedder(): Embedder {
  const provider = process.env.EMBEDDING_PROVIDER ?? "transformers";
  let embedder: Embedder;

  if (provider === "openai" && process.env.OPENAI_API_KEY) {
    embedder = new OpenAIEmbedder({
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_EMBEDDING_MODEL,
      dimensions: Number(process.env.OPENAI_EMBEDDING_DIMENSIONS ?? 512)
    });
  } else if (provider === "hashing") {
    embedder = new HashingEmbedder(Number(process.env.LOCAL_EMBEDDING_DIMENSIONS ?? 384));
  } else {
    embedder = new TransformersEmbedder();
  }

  if (process.env.EMBEDDING_CACHE === "off") return embedder;
  return new CachingEmbedder(embedder);
}

export async function embedInBatches(
  texts: string[],
  embedder: Embedder,
  options: { batchSize?: number; concurrency?: number } = {}
): Promise<number[][]> {
  const batchSize = options.batchSize ?? Number(process.env.EMBED_BATCH_SIZE ?? 64);
  const concurrency = options.concurrency ?? embedder.maxConcurrency ?? Number(process.env.EMBED_CONCURRENCY ?? 4);
  const batches: Array<{ index: number; texts: string[] }> = [];

  for (let index = 0; index < texts.length; index += batchSize) {
    batches.push({ index, texts: texts.slice(index, index + batchSize) });
  }

  const results = new Array<number[]>(texts.length);
  let next = 0;

  async function worker() {
    while (next < batches.length) {
      const batch = batches[next++];
      const embeddings = await embedder.embedBatch(batch.texts);
      embeddings.forEach((embedding, offset) => {
        results[batch.index + offset] = embedding;
      });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
  return results;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return -Infinity;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot;
}

function hashingVector(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const tokens = tokenize(text);

  for (let i = 0; i < tokens.length; i += 1) {
    addFeature(vector, tokens[i], 1);
    if (i + 1 < tokens.length) addFeature(vector, `${tokens[i]}_${tokens[i + 1]}`, 0.35);
  }

  return normalizeVector(vector);
}

function addFeature(vector: number[], feature: string, weight: number): void {
  const hash = fnv1a(feature);
  const index = hash % vector.length;
  const sign = hash & 0x80000000 ? -1 : 1;
  vector[index] += sign * weight;
}

function normalizeVector(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm) return vector;
  return vector.map((value) => Number((value / norm).toFixed(6)));
}

function cacheKey(model: string, text: string): string {
  return sha256(`${model}\n${normalizeText(text)}`);
}

interface EmbeddingCacheFile {
  version: 1;
  entries: Record<
    string,
    {
      dimensions: number;
      embedding: number[];
      insertedAt: string;
      model: string;
    }
  >;
}

interface FeatureExtractor {
  (texts: string[], options: { pooling: "mean"; normalize: boolean }): Promise<{
    tolist(): number[][];
  }>;
}
