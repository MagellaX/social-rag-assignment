export type Platform = "linkedin" | "twitter" | "instagram";

export type ContentKind =
  | "profile"
  | "post"
  | "comment"
  | "caption"
  | "bio"
  | "other";

export interface SourceFile {
  path: string;
  originalName: string;
  mimeType?: string;
  size?: number;
  cleanup?: boolean;
}

export interface ParsedItem {
  platform: Platform;
  kind: ContentKind;
  text: string;
  externalId?: string;
  authoredAt?: string;
  title?: string;
  uri?: string;
  metadata?: Record<string, unknown>;
}

export interface ParsedDocument {
  id: string;
  personId: string;
  platform: Platform;
  kind: ContentKind;
  title: string;
  text: string;
  externalId?: string;
  authoredAt?: string;
  uri?: string;
  sourceFile: string;
  contentHash: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Chunk {
  id: string;
  documentId: string;
  personId: string;
  platform: Platform;
  kind: ContentKind;
  text: string;
  ordinal: number;
  tokenCount: number;
  contentHash: string;
  authoredAt?: string;
  uri?: string;
  sourceTitle: string;
  metadata: Record<string, unknown>;
}

export interface StoredChunk extends Chunk {
  embedding: number[];
  embeddingModel: string;
  embeddingDimensions: number;
  insertedAt: string;
}

export interface StoreSchema {
  version: 1;
  people: Array<{
    id: string;
    displayName: string;
    createdAt: string;
    updatedAt: string;
  }>;
  documents: ParsedDocument[];
  chunks: StoredChunk[];
}

export interface ReindexResult {
  chunksSeen: number;
  chunksReindexed: number;
  embeddingModel: string;
  embeddingDimensions: number;
}

export interface Citation {
  id: string;
  platform: Platform;
  kind: ContentKind;
  title: string;
  authoredAt?: string;
  uri?: string;
  excerpt: string;
  score: number;
  vectorScore?: number;
  lexicalScore?: number;
  matchedTerms?: string[];
}

export interface ChatAnswer {
  answer: string;
  citations: Citation[];
  provider: "openai" | "extractive";
}

export interface SourceDocumentSummary {
  id: string;
  platform: Platform;
  kind: ContentKind;
  title: string;
  authoredAt?: string;
  uri?: string;
  sourceFile: string;
  excerpt: string;
  chunkCount: number;
  tokenCount: number;
  metadata: Record<string, unknown>;
}
