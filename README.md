# Social RAG Assignment

This is a runnable end-to-end social export RAG system. It accepts LinkedIn CSV exports, Twitter/X JSON or JS exports, and Instagram JSON or HTML exports; extracts authored/person-representative content; chunks it; embeds it; stores it in a local vector index; and answers questions with retrieved citations. The UI also includes an evidence browser, source filtering, retrieval mode controls, and per-citation score breakdowns so retrieval behavior is inspectable instead of hidden.

## Run

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. The API runs on `http://127.0.0.1:8787`.

To ingest fixtures without the UI:

```bash
npm run ingest:samples
```

## Configuration

By default the app uses a local Transformers.js embedding model, `Xenova/all-MiniLM-L6-v2`, cached under `data/model-cache`. Embeddings are also cached by normalized text hash and model in `data/embedding-cache.json`, so repeated ingestion or reindexing does not recompute unchanged chunks. To force the original cheap fallback for tests or offline troubleshooting, set `EMBEDDING_PROVIDER=hashing`. To use OpenAI embeddings and chat, set:

```bash
EMBEDDING_PROVIDER=openai
CHAT_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_EMBEDDING_DIMENSIONS=512
OPENAI_CHAT_MODEL=gpt-4o-mini
```

If an existing index was built with a different embedding model, click **Reindex embeddings** in the UI or call:

```bash
curl -X POST http://127.0.0.1:8787/api/reindex -H "Content-Type: application/json" -d "{}"
```

The Vercel deployment uses the `EMBEDDING_PROVIDER=hashing` fallback with a seeded sample index so the public demo stays responsive on serverless functions. The local/default path remains the real MiniLM embedding model; this is an explicit deployment tradeoff, not the core retrieval design.

## Architecture Answers

What the system does, and the most important architecture decisions: The system turns messy social exports into a queryable knowledge base about one person, then answers questions through retrieval-augmented generation with source citations. The most important decisions were: parser modules use a small `SourceParser` interface so a fourth platform is mostly a new file plus registry entry; chunking is semantic-ish by profile/post/sentence boundaries rather than raw character windows; embeddings default to a real local MiniLM model with cache and explicit reindexing instead of a toy deterministic hash; retrieval is hybrid, combining vector similarity with exact-token lexical overlap and exposing both scores in the UI; and the vector store is local and persisted as an explicit schema so the project runs without Docker, Pinecone, or a paid account while still supporting dedupe, incremental upserts, metadata filtering, and retrieval.

Where the bottleneck is at 10x data volume: Retrieval breaks first, because this implementation scans stored vectors linearly and also computes lexical overlap in process. That is useful for transparency and a small local demo, but at 100k to 1M chunks it needs an ANN-backed vector index plus a real inverted index, such as pgvector plus Postgres full-text search, Qdrant with payload filters, or OpenSearch paired with a vector store. Ingestion also becomes constrained by local embedding throughput: MiniLM is free and private, but CPU inference is slower than a hosted embedding API. File parsing is the other pressure point; LinkedIn CSV parsing is streamed, but Twitter and Instagram JSON are currently read per file.

What was consciously cut in the 4 to 6 hour window: I cut production auth, multi-tenant isolation, background job orchestration, streaming chat, a real ANN index, and exhaustive platform export coverage. I also made OpenAI optional so the app can be tested without secrets, which means the default answerer is extractive rather than a full LLM synthesis. Next I would add durable background ingestion jobs with resumable progress, platform-specific fixtures from real archives, better date normalization, full-text indexing, query evaluation tests that compare hybrid/vector/keyword modes, and dependency hardening for the local model runtime.

If making the architecture 10x better, what would change: I would split ingestion into durable jobs and store raw parsed documents, chunks, and embeddings in Postgres with pgvector or Qdrant behind a repository interface. I would add an embedding cache keyed by normalized text hash and model, use a proper hybrid retriever with ANN vector search, BM25/full-text search, metadata filters, and recency/source weighting, and move parsing to streaming/evented readers for all export types. That would make the system safer under large exports, easier to re-embed when models change, more explainable at query time, and more honest about latency under load.

## Storage Schema

The persisted store lives at `data/vector-store.json`:

- `people`: person id, display name, timestamps.
- `documents`: platform, kind, source file, source URI, authored date, external id, content hash, text, metadata.
- `chunks`: document id, chunk text, ordinal, token count, platform/kind metadata, embedding model, dimensions, normalized vector, insertion timestamp.

The schema keeps platform and content kind as metadata instead of baking platform-specific columns into the vector records, so new content types can be added without a rewrite.

## Efficiency Notes

Uploads are written to disk by `multer` instead of buffered in memory. LinkedIn CSVs are parsed as streams. Chunk upserts are content-hash deduped, so re-ingesting the same export skips embedding work. Embeddings are batched and cached; Transformers.js inference is intentionally single-concurrency by default to avoid loading multiple ONNX sessions at once, while OpenAI/hash providers can use configurable concurrency via `EMBED_BATCH_SIZE` and `EMBED_CONCURRENCY`. Query-time retrieval is hybrid by default: vector similarity handles paraphrase, keyword overlap catches exact names/topics, and citations include both scores plus matched terms. The tradeoff is that both vector and lexical scoring are currently linear scans over the local store; it is simple and inspectable for this scope, but it is the first thing I would replace for a larger deployment. Installing the local Transformers runtime also brings native/transitive dependencies, so a production version would pin and audit that runtime carefully.
