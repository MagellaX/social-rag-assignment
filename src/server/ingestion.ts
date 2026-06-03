import { unlink } from "node:fs/promises";
import { itemToDocument } from "./chunker";
import { createEmbedder } from "./embeddings";
import { parserFor } from "./parsers";
import type { ParsedDocument, SourceFile } from "./types";
import { VectorStore, type IngestResult } from "./vectorStore";

export interface IngestOptions {
  personId: string;
  displayName: string;
}

export async function ingestFiles(
  files: SourceFile[],
  store: VectorStore,
  options: IngestOptions
): Promise<IngestResult & { unsupportedFiles: string[]; parsedDocuments: number }> {
  const documents: ParsedDocument[] = [];
  const unsupportedFiles: string[] = [];

  for (const file of files) {
    const parser = parserFor(file);
    if (!parser) {
      unsupportedFiles.push(file.originalName);
      continue;
    }

    for await (const item of parser.parse(file)) {
      documents.push(itemToDocument(item, file, options.personId));
    }
  }

  const embedder = createEmbedder();
  const result =
    documents.length > 0
      ? await store.upsertDocuments(documents, embedder, { personDisplayName: options.displayName })
      : emptyResult(embedder.model);

  await Promise.allSettled(files.filter((file) => file.cleanup).map((file) => unlink(file.path)));

  return {
    ...result,
    unsupportedFiles,
    parsedDocuments: documents.length
  };
}

function emptyResult(embeddingModel: string): IngestResult {
  return {
    documentsSeen: 0,
    documentsInserted: 0,
    chunksSeen: 0,
    chunksInserted: 0,
    chunksSkippedAsDuplicates: 0,
    embeddingModel
  };
}
