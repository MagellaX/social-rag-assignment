import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { chunkDocument } from "./chunker";
import { cosineSimilarity, embedInBatches, type Embedder } from "./embeddings";
import { excerpt, tokenize } from "./lib/text";
import type { Chunk, ParsedDocument, ReindexResult, SourceDocumentSummary, StoreSchema, StoredChunk } from "./types";

export interface IngestResult {
  documentsSeen: number;
  documentsInserted: number;
  chunksSeen: number;
  chunksInserted: number;
  chunksSkippedAsDuplicates: number;
  embeddingModel: string;
}

export class VectorStore {
  private db?: StoreSchema;

  constructor(private readonly filePath: string) {}

  async load(): Promise<StoreSchema> {
    if (this.db) return this.db;
    try {
      this.db = JSON.parse(await readFile(this.filePath, "utf8")) as StoreSchema;
    } catch {
      this.db = { version: 1, people: [], documents: [], chunks: [] };
    }
    return this.db;
  }

  async save(): Promise<void> {
    if (!this.db) return;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(this.db, null, 2));
    await rename(tempPath, this.filePath);
  }

  async ensurePerson(personId: string, displayName: string): Promise<void> {
    const db = await this.load();
    const now = new Date().toISOString();
    const existing = db.people.find((person) => person.id === personId);
    if (existing) {
      existing.displayName = displayName || existing.displayName;
      existing.updatedAt = now;
      return;
    }
    db.people.push({ id: personId, displayName: displayName || personId, createdAt: now, updatedAt: now });
  }

  async upsertDocuments(
    documents: ParsedDocument[],
    embedder: Embedder,
    options: { personDisplayName: string }
  ): Promise<IngestResult> {
    const db = await this.load();
    await this.ensurePerson(documents[0]?.personId ?? "default", options.personDisplayName);

    const documentHashes = new Set(db.documents.map((document) => document.contentHash));
    const chunkHashes = new Set(db.chunks.map((chunk) => chunk.contentHash));
    const newDocuments: ParsedDocument[] = [];
    const newChunks: Chunk[] = [];
    let chunksSeen = 0;
    let duplicateChunks = 0;

    for (const document of documents) {
      if (!documentHashes.has(document.contentHash)) {
        db.documents.push(document);
        documentHashes.add(document.contentHash);
        newDocuments.push(document);
      }

      for (const chunk of chunkDocument(document)) {
        chunksSeen += 1;
        if (chunkHashes.has(chunk.contentHash)) {
          duplicateChunks += 1;
          continue;
        }
        chunkHashes.add(chunk.contentHash);
        newChunks.push(chunk);
      }
    }

    const embeddings = await embedInBatches(newChunks.map((chunk) => chunk.text), embedder);
    const now = new Date().toISOString();

    newChunks.forEach((chunk, index) => {
      db.chunks.push({
        ...chunk,
        embedding: embeddings[index],
        embeddingModel: embedder.model,
        embeddingDimensions: embedder.dimensions,
        insertedAt: now
      });
    });

    await this.save();

    return {
      documentsSeen: documents.length,
      documentsInserted: newDocuments.length,
      chunksSeen,
      chunksInserted: newChunks.length,
      chunksSkippedAsDuplicates: duplicateChunks,
      embeddingModel: embedder.model
    };
  }

  async search(
    queryEmbedding: number[],
    options: {
      k?: number;
      personId?: string;
      platform?: string;
      query?: string;
      mode?: "hybrid" | "vector" | "keyword";
      embeddingModel?: string;
    }
  ): Promise<Array<StoredChunk & { score: number; vectorScore: number; lexicalScore: number; matchedTerms: string[] }>> {
    const db = await this.load();
    const k = options.k ?? 8;
    const queryTokens = tokenize(options.query ?? "");
    const queryTokenSet = new Set(queryTokens);
    const mode = options.mode ?? "hybrid";

    return db.chunks
      .filter((chunk) => !options.personId || chunk.personId === options.personId)
      .filter((chunk) => !options.platform || chunk.platform === options.platform)
      .filter((chunk) => !options.embeddingModel || chunk.embeddingModel === options.embeddingModel)
      .filter((chunk) => chunk.embeddingDimensions === queryEmbedding.length)
      .map((chunk) => {
        const vectorScore = cosineSimilarity(queryEmbedding, chunk.embedding);
        const lexical = lexicalMatch(chunk.text, queryTokenSet);
        const score =
          mode === "vector"
            ? vectorScore
            : mode === "keyword"
              ? lexical.score
              : vectorScore * 0.72 + lexical.score * 0.28;

        return {
          ...chunk,
          score,
          vectorScore,
          lexicalScore: lexical.score,
          matchedTerms: lexical.matchedTerms
        };
      })
      .filter((chunk) => Number.isFinite(chunk.score))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  async rebuildEmbeddings(embedder: Embedder, options: { force?: boolean } = {}): Promise<ReindexResult> {
    const db = await this.load();
    const targetChunks = db.chunks.filter(
      (chunk) =>
        options.force ||
        chunk.embeddingModel !== embedder.model ||
        chunk.embeddingDimensions !== embedder.dimensions ||
        chunk.embedding.length !== embedder.dimensions
    );

    const embeddings = await embedInBatches(
      targetChunks.map((chunk) => chunk.text),
      embedder
    );
    const now = new Date().toISOString();

    targetChunks.forEach((chunk, index) => {
      chunk.embedding = embeddings[index];
      chunk.embeddingModel = embedder.model;
      chunk.embeddingDimensions = embedder.dimensions;
      chunk.insertedAt = now;
    });

    await this.save();

    return {
      chunksSeen: db.chunks.length,
      chunksReindexed: targetChunks.length,
      embeddingModel: embedder.model,
      embeddingDimensions: embedder.dimensions
    };
  }

  async listDocuments(options: { limit?: number; platform?: string; q?: string } = {}): Promise<SourceDocumentSummary[]> {
    const db = await this.load();
    const limit = options.limit ?? 40;
    const q = options.q?.trim().toLowerCase();

    return db.documents
      .filter((document) => !options.platform || document.platform === options.platform)
      .filter((document) => !q || `${document.title} ${document.text} ${document.sourceFile}`.toLowerCase().includes(q))
      .sort((a, b) => String(b.authoredAt ?? b.updatedAt).localeCompare(String(a.authoredAt ?? a.updatedAt)))
      .slice(0, limit)
      .map((document) => {
        const chunks = db.chunks.filter((chunk) => chunk.documentId === document.id);
        return {
          id: document.id,
          platform: document.platform,
          kind: document.kind,
          title: document.title,
          authoredAt: document.authoredAt,
          uri: document.uri,
          sourceFile: document.sourceFile,
          excerpt: excerpt(document.text, 220),
          chunkCount: chunks.length,
          tokenCount: chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0),
          metadata: document.metadata
        };
      });
  }

  async stats(): Promise<{
    people: number;
    documents: number;
    chunks: number;
    platforms: Record<string, number>;
    embeddingModels: Record<string, number>;
  }> {
    const db = await this.load();
    return {
      people: db.people.length,
      documents: db.documents.length,
      chunks: db.chunks.length,
      platforms: countBy(db.documents, (document) => document.platform),
      embeddingModels: countBy(db.chunks, (chunk) => chunk.embeddingModel)
    };
  }
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function lexicalMatch(text: string, queryTokenSet: Set<string>): { score: number; matchedTerms: string[] } {
  if (!queryTokenSet.size) return { score: 0, matchedTerms: [] };

  const chunkTokens = tokenize(text);
  if (!chunkTokens.length) return { score: 0, matchedTerms: [] };

  const chunkTokenSet = new Set(chunkTokens);
  const matchedTerms = Array.from(queryTokenSet).filter((token) => chunkTokenSet.has(token));
  const score = matchedTerms.length / Math.sqrt(queryTokenSet.size * chunkTokenSet.size);

  return { score, matchedTerms };
}
