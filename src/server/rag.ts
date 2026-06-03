import { createEmbedder } from "./embeddings";
import { excerpt, splitSentences, tokenize } from "./lib/text";
import type { ChatAnswer, Citation, StoredChunk } from "./types";
import type { VectorStore } from "./vectorStore";

export async function answerQuestion(
  question: string,
  store: VectorStore,
  options: { personId?: string; k?: number; platform?: string; mode?: "hybrid" | "vector" | "keyword" } = {}
): Promise<ChatAnswer> {
  const embedder = createEmbedder();
  const [queryEmbedding] = await embedder.embedBatch([question]);
  const chunks = await store.search(queryEmbedding, {
    personId: options.personId,
    platform: options.platform,
    k: options.k ?? 8,
    query: question,
    mode: options.mode ?? "hybrid",
    embeddingModel: embedder.model
  });

  if (!chunks.length) {
    return {
      provider: "extractive",
      answer:
        "I do not have enough indexed data for the active embedding model to answer that yet. Reindex embeddings if the index was built with another model.",
      citations: []
    };
  }

  const citations = chunks.map(chunkToCitation);

  if (process.env.CHAT_PROVIDER === "openai" && process.env.OPENAI_API_KEY) {
    return {
      provider: "openai",
      answer: await answerWithOpenAI(question, chunks),
      citations
    };
  }

  return {
    provider: "extractive",
    answer: answerExtractively(question, chunks),
    citations
  };
}

function chunkToCitation(
  chunk: StoredChunk & { score: number; vectorScore?: number; lexicalScore?: number; matchedTerms?: string[] }
): Citation {
  return {
    id: chunk.id,
    platform: chunk.platform,
    kind: chunk.kind,
    title: chunk.sourceTitle,
    authoredAt: chunk.authoredAt,
    uri: chunk.uri,
    excerpt: excerpt(chunk.text),
    score: Number(chunk.score.toFixed(4)),
    vectorScore: chunk.vectorScore === undefined ? undefined : Number(chunk.vectorScore.toFixed(4)),
    lexicalScore: chunk.lexicalScore === undefined ? undefined : Number(chunk.lexicalScore.toFixed(4)),
    matchedTerms: chunk.matchedTerms
  };
}

async function answerWithOpenAI(
  question: string,
  chunks: Array<StoredChunk & { score: number; matchedTerms?: string[] }>
): Promise<string> {
  const context = chunks
    .map(
      (chunk, index) =>
        `[${index + 1}] ${chunk.platform} ${chunk.kind}${chunk.authoredAt ? ` (${chunk.authoredAt})` : ""}: ${chunk.text}`
    )
    .join("\n\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Answer only from the provided social export context. Cite claims with bracketed source numbers. If the evidence is thin, say so."
        },
        {
          role: "user",
          content: `Question: ${question}\n\nContext:\n${context}`
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI chat failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as { choices: Array<{ message?: { content?: string } }> };
  return body.choices[0]?.message?.content?.trim() || "The model returned an empty answer.";
}

function answerExtractively(question: string, chunks: Array<StoredChunk & { score: number }>): string {
  const queryTokens = new Set(tokenize(question));
  const candidates = chunks
    .flatMap((chunk, chunkIndex) =>
      splitSentences(chunk.text).map((sentence) => {
        const sentenceScore = scoreSentence(sentence, queryTokens);
        return {
          sentence,
          source: chunkIndex + 1,
          sentenceScore,
          score: sentenceScore + chunk.score
        };
      })
    )
    .sort((a, b) => b.score - a.score);

  const evidence = (candidates.some((item) => item.sentenceScore > 0) ? candidates.filter((item) => item.sentenceScore > 0) : candidates)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  if (!evidence.length) {
    return `The retrieved data is relevant, but it is too terse to synthesize confidently. Start with source [1].`;
  }

  const body = evidence.map((item) => `${item.sentence} [${item.source}]`).join(" ");
  return `Based on the ingested exports, the strongest grounded evidence is: ${body}`;
}

function scoreSentence(sentence: string, queryTokens: Set<string>): number {
  const sentenceTokens = tokenize(sentence);
  if (!sentenceTokens.length) return 0;
  const overlap = sentenceTokens.filter((token) => queryTokens.has(token)).length;
  return overlap / Math.sqrt(sentenceTokens.length);
}
