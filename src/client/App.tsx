import {
  Bot,
  CheckCircle2,
  Database,
  FileJson,
  FileSpreadsheet,
  FileText,
  Layers3,
  MessageSquare,
  RotateCcw,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  User,
  X
} from "lucide-react";
import { DragEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

interface Stats {
  people: number;
  documents: number;
  chunks: number;
  platforms: Record<string, number>;
  embeddingModels: Record<string, number>;
  activeEmbeddingModel: string;
  activeEmbeddingDimensions: number;
  needsReindex: boolean;
}

interface Citation {
  id: string;
  platform: string;
  kind: string;
  title: string;
  authoredAt?: string;
  uri?: string;
  excerpt: string;
  score: number;
  vectorScore?: number;
  lexicalScore?: number;
  matchedTerms?: string[];
}

interface ChatResponse {
  answer: string;
  provider: string;
  citations: Citation[];
}

interface IngestResult {
  documentsSeen: number;
  documentsInserted: number;
  chunksSeen: number;
  chunksInserted: number;
  chunksSkippedAsDuplicates: number;
  unsupportedFiles: string[];
  parsedDocuments: number;
  embeddingModel: string;
}

interface ReindexResult {
  chunksSeen: number;
  chunksReindexed: number;
  embeddingModel: string;
  embeddingDimensions: number;
}

interface ChatTurn {
  id: string;
  question: string;
  response?: ChatResponse;
  error?: string;
}

interface SourceDocument {
  id: string;
  platform: string;
  kind: string;
  title: string;
  authoredAt?: string;
  uri?: string;
  sourceFile: string;
  excerpt: string;
  chunkCount: number;
  tokenCount: number;
}

type RetrievalMode = "hybrid" | "vector" | "keyword";

const promptSuggestions = [
  "What does this person think about remote work?",
  "What topics does this person write about most?",
  "What would this person likely value in a team?",
  "Summarize their professional point of view"
];

export function App() {
  const [displayName, setDisplayName] = useState("Imported person");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [documents, setDocuments] = useState<SourceDocument[]>([]);
  const [ingestResult, setIngestResult] = useState<IngestResult | null>(null);
  const [ingestError, setIngestError] = useState("");
  const [reindexResult, setReindexResult] = useState<ReindexResult | null>(null);
  const [reindexError, setReindexError] = useState("");
  const [question, setQuestion] = useState(promptSuggestions[0]);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [busyMode, setBusyMode] = useState<"idle" | "ingesting" | "asking" | "reindexing">("idle");
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [refreshError, setRefreshError] = useState("");
  const [retrievalMode, setRetrievalMode] = useState<RetrievalMode>("hybrid");
  const [retrievalPlatform, setRetrievalPlatform] = useState("all");
  const [topK, setTopK] = useState(8);
  const [sourcePlatform, setSourcePlatform] = useState("all");
  const [sourceQuery, setSourceQuery] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);

  const busy = busyMode !== "idle";
  const platformEntries = Object.entries(stats?.platforms ?? {});
  const hasIndex = Boolean(stats?.chunks);
  const queueSize = useMemo(() => selectedFiles.reduce((sum, file) => sum + file.size, 0), [selectedFiles]);

  useEffect(() => {
    refreshStats();
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [sourcePlatform, sourceQuery]);

  useEffect(() => {
    if (busyMode !== "asking") return;
    conversationRef.current?.scrollTo({
      top: conversationRef.current.scrollHeight,
      behavior: "smooth"
    });
  }, [busyMode, turns.length]);

  async function refreshStats() {
    setRefreshing(true);
    setRefreshError("");
    try {
      const response = await fetch("/api/stats");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not refresh stats");
      setStats(result);
      await loadDocuments();
      setLastRefreshedAt(new Date());
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "Could not refresh stats");
    } finally {
      setRefreshing(false);
    }
  }

  async function loadDocuments() {
    const params = new URLSearchParams({ limit: "30" });
    if (sourcePlatform !== "all") params.set("platform", sourcePlatform);
    if (sourceQuery.trim()) params.set("q", sourceQuery.trim());
    const response = await fetch(`/api/documents?${params}`);
    if (!response.ok) return;
    setDocuments(await response.json());
  }

  function addFiles(files: FileList | File[]) {
    const nextFiles = Array.from(files);
    setSelectedFiles((current) => {
      const seen = new Set(current.map(fileKey));
      return [...current, ...nextFiles.filter((file) => !seen.has(fileKey(file)))];
    });
    setIngestError("");
  }

  function removeFile(target: File) {
    setSelectedFiles((current) => current.filter((file) => fileKey(file) !== fileKey(target)));
  }

  function clearQueue() {
    setSelectedFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
  }

  async function ingest(event: FormEvent) {
    event.preventDefault();
    if (!selectedFiles.length) return;

    setBusyMode("ingesting");
    setIngestError("");
    setIngestResult(null);
    const body = new FormData();
    body.set("displayName", displayName);
    selectedFiles.forEach((file) => body.append("files", file));

    try {
      const response = await fetch("/api/ingest", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Ingestion failed");
      setIngestResult(result);
      clearQueue();
      await refreshStats();
    } catch (error) {
      setIngestError(error instanceof Error ? error.message : "Ingestion failed");
    } finally {
      setBusyMode("idle");
    }
  }

  async function reindexEmbeddings() {
    setBusyMode("reindexing");
    setReindexError("");
    setReindexResult(null);

    try {
      const response = await fetch("/api/reindex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: false })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Reindex failed");
      setReindexResult(result);
      await refreshStats();
    } catch (error) {
      setReindexError(error instanceof Error ? error.message : "Reindex failed");
    } finally {
      setBusyMode("idle");
    }
  }

  async function ask(event?: FormEvent) {
    event?.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) return;

    const id = crypto.randomUUID();
    setTurns((current) => [...current, { id, question: trimmed }]);
    setQuestion("");
    setBusyMode("asking");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          k: topK,
          mode: retrievalMode,
          platform: retrievalPlatform === "all" ? undefined : retrievalPlatform
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Chat failed");
      setTurns((current) => current.map((turn) => (turn.id === id ? { ...turn, response: result } : turn)));
    } catch (error) {
      setTurns((current) =>
        current.map((turn) =>
          turn.id === id ? { ...turn, error: error instanceof Error ? error.message : "Chat failed" } : turn
        )
      );
    } finally {
      setBusyMode("idle");
    }
  }

  function onQuestionKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!busy && question.trim()) ask();
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <div className="brand-mark">
            <Sparkles size={19} />
          </div>
          <div>
            <h1>Social RAG</h1>
            <p>Social export intelligence with grounded answers.</p>
          </div>
        </div>

        <div className="header-actions">
          <button className="ghost-button" type="button" onClick={refreshStats} disabled={busy || refreshing}>
            <RotateCcw className={refreshing ? "is-spinning" : ""} size={16} />
            {refreshing ? "Refreshing" : "Refresh"}
          </button>
          <Metric icon={<Database size={18} />} label="Documents" value={stats?.documents ?? 0} />
          <Metric icon={<FileText size={18} />} label="Chunks" value={stats?.chunks ?? 0} />
        </div>
      </header>

      <section className="workbench">
        <aside className="side-rail">
          <form className="surface upload-surface" onSubmit={ingest}>
            <SectionHeading icon={<Upload size={18} />} title="Ingest" />

            <label className="field">
              <span>Person</span>
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </label>

            <div
              className={`dropzone ${dragActive ? "is-dragging" : ""}`}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragActive(false)}
              onDrop={onDrop}
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") fileInputRef.current?.click();
              }}
            >
              <div className="dropzone-icon">
                <Upload size={22} />
              </div>
              <strong>
                {selectedFiles.length ? `${selectedFiles.length} file${selectedFiles.length > 1 ? "s" : ""}` : "Drop exports"}
              </strong>
              <span>LinkedIn CSV, X JSON, Instagram JSON or HTML</span>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".csv,.json,.js,.html,.htm"
                onChange={(event) => event.target.files && addFiles(event.target.files)}
              />
            </div>

            {selectedFiles.length > 0 && (
              <div className="file-queue">
                <div className="queue-header">
                  <span>{formatBytes(queueSize)}</span>
                  <button className="icon-button" type="button" onClick={clearQueue} aria-label="Clear files">
                    <Trash2 size={15} />
                  </button>
                </div>
                {selectedFiles.map((file) => (
                  <div className="file-chip" key={fileKey(file)}>
                    {fileIcon(file.name)}
                    <span>{file.name}</span>
                    <small>{formatBytes(file.size)}</small>
                    <button className="icon-button" type="button" onClick={() => removeFile(file)} aria-label={`Remove ${file.name}`}>
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button className="primary-button" disabled={busy || !selectedFiles.length} type="submit">
              <Upload size={16} />
              {busyMode === "ingesting" ? "Indexing" : "Ingest exports"}
            </button>

            {(ingestResult || ingestError) && (
              <div className={`result-banner ${ingestError ? "is-error" : ""}`}>
                {ingestError ? <X size={16} /> : <CheckCircle2 size={16} />}
                <span>
                  {ingestError ||
                    `${ingestResult?.parsedDocuments ?? 0} parsed - ${ingestResult?.chunksInserted ?? 0} new chunks - ${ingestResult?.chunksSkippedAsDuplicates ?? 0} duplicates`}
                </span>
              </div>
            )}
          </form>

          <section className="surface index-surface">
            <SectionHeading icon={<Search size={18} />} title="Index" />
            <div className={`refresh-note ${refreshError ? "is-error" : ""}`}>
              {refreshError || (lastRefreshedAt ? `Updated ${formatClock(lastRefreshedAt)}` : "Waiting for first refresh")}
            </div>
            <div className={`index-state ${hasIndex ? "is-ready" : ""} ${stats?.needsReindex ? "needs-reindex" : ""}`}>
              <span />
              <strong>{stats?.needsReindex ? "Reindex needed" : hasIndex ? "Ready" : "Empty"}</strong>
              <small>
                {hasIndex
                  ? `${stats?.chunks ?? 0} searchable chunks - active ${stats?.activeEmbeddingModel ?? "unknown"}`
                  : "No chunks indexed"}
              </small>
            </div>

            <button className="secondary-button" type="button" onClick={reindexEmbeddings} disabled={busy || !hasIndex}>
              <RotateCcw className={busyMode === "reindexing" ? "is-spinning" : ""} size={15} />
              {busyMode === "reindexing" ? "Reindexing embeddings" : "Reindex embeddings"}
            </button>

            {(reindexResult || reindexError) && (
              <div className={`result-banner compact ${reindexError ? "is-error" : ""}`}>
                {reindexError ? <X size={16} /> : <CheckCircle2 size={16} />}
                <span>
                  {reindexError ||
                    `${reindexResult?.chunksReindexed ?? 0}/${reindexResult?.chunksSeen ?? 0} chunks embedded with ${reindexResult?.embeddingModel}`}
                </span>
              </div>
            )}

            <div className="source-mix">
              {platformEntries.length ? (
                platformEntries.map(([platform, count]) => (
                  <div className="source-row" key={platform}>
                    <span>{platform}</span>
                    <div className="source-bar">
                      <i style={{ width: `${sourcePercent(count, stats?.documents ?? 0)}%` }} />
                    </div>
                    <strong>{count}</strong>
                  </div>
                ))
              ) : (
                <p className="muted">No source data yet.</p>
              )}
            </div>

            <div className="model-list">
              {Object.entries(stats?.embeddingModels ?? {}).map(([model, count]) => (
                <span className="pill" key={model}>
                  {model} - {count}
                </span>
              ))}
            </div>
          </section>

          <section className="surface sources-surface">
            <SectionHeading icon={<Layers3 size={18} />} title="Evidence" />
            <div className="source-controls">
              <select value={sourcePlatform} onChange={(event) => setSourcePlatform(event.target.value)} aria-label="Source platform">
                <option value="all">All platforms</option>
                <option value="linkedin">LinkedIn</option>
                <option value="twitter">Twitter/X</option>
                <option value="instagram">Instagram</option>
              </select>
              <input
                aria-label="Filter sources"
                value={sourceQuery}
                onChange={(event) => setSourceQuery(event.target.value)}
                placeholder="Filter evidence"
              />
            </div>
            <div className="document-list">
              {documents.length ? (
                documents.map((document) => <DocumentCard document={document} key={document.id} />)
              ) : (
                <p className="muted">No matching evidence.</p>
              )}
            </div>
          </section>
        </aside>

        <section className="chat-workspace">
          <div className="surface chat-surface">
            <div className="chat-header">
              <SectionHeading icon={<MessageSquare size={18} />} title="Chat" />
              <div className="status-pill">
                <span className={busyMode === "asking" ? "pulse" : ""} />
                {busyMode === "asking" ? "Retrieving" : hasIndex ? "Grounded" : "Waiting"}
              </div>
            </div>

            <div className="prompt-strip">
              {promptSuggestions.map((prompt) => (
                <button className="prompt-chip" key={prompt} type="button" onClick={() => setQuestion(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>

            <div className="retrieval-toolbar">
              <div className="toolbar-group">
                <SlidersHorizontal size={15} />
                <select
                  value={retrievalMode}
                  onChange={(event) => setRetrievalMode(event.target.value as RetrievalMode)}
                  aria-label="Retrieval mode"
                >
                  <option value="hybrid">Hybrid retrieval</option>
                  <option value="vector">Vector only</option>
                  <option value="keyword">Keyword only</option>
                </select>
              </div>
              <select
                value={retrievalPlatform}
                onChange={(event) => setRetrievalPlatform(event.target.value)}
                aria-label="Answer source filter"
              >
                <option value="all">All sources</option>
                <option value="linkedin">LinkedIn only</option>
                <option value="twitter">Twitter/X only</option>
                <option value="instagram">Instagram only</option>
              </select>
              <div className="topk-control" aria-label="Retrieved source count">
                {[5, 8, 12].map((value) => (
                  <button
                    className={topK === value ? "is-selected" : ""}
                    key={value}
                    type="button"
                    onClick={() => setTopK(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>

            <div className="conversation" ref={conversationRef}>
              {!turns.length && (
                <div className="empty-state">
                  <Bot size={34} />
                  <h2>No questions yet</h2>
                  <p>Ready for a grounded read on the indexed exports.</p>
                </div>
              )}

              {turns.map((turn) => (
                <article className="turn" key={turn.id}>
                  <div className="message user-message">
                    <Avatar icon={<User size={16} />} />
                    <div className="bubble">{turn.question}</div>
                  </div>

                  <div className="message assistant-message">
                    <Avatar icon={<Bot size={16} />} />
                    <div className="assistant-stack">
                      {!turn.response && !turn.error && (
                        <div className="bubble loading-line">
                          <span />
                          <span />
                          <span />
                        </div>
                      )}

                      {turn.error && <div className="bubble error-bubble">{turn.error}</div>}

                      {turn.response && (
                        <>
                          <div className="bubble answer-bubble">
                            <div className="provider-row">
                              <span>{turn.response.provider}</span>
                              <strong>{citationCountLabel(turn.response.citations)}</strong>
                            </div>
                            <p>{turn.response.answer}</p>
                          </div>

                          <div className="citation-grid">
                            {visibleCitations(turn.response.citations).map(({ citation, index }) => (
                              <SourceCard citation={citation} index={index} key={citation.id} />
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <form className="composer" onSubmit={ask}>
              <textarea
                aria-label="Question"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={onQuestionKeyDown}
                rows={3}
                placeholder="Ask about opinions, work style, interests, or recurring themes"
              />
              <button className="send-button" disabled={busy || !question.trim()} type="submit" aria-label="Ask">
                <Send size={18} />
              </button>
            </form>
          </div>
        </section>
      </section>
    </main>
  );
}

function SectionHeading({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="section-heading">
      {icon}
      <h2>{title}</h2>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Avatar({ icon }: { icon: React.ReactNode }) {
  return <div className="avatar">{icon}</div>;
}

function SourceCard({ citation, index }: { citation: Citation; index: number }) {
  const content = (
    <>
      <div className="source-card-top">
        <strong>[{index + 1}]</strong>
        <span>
          {citation.platform} - {citation.kind}
        </span>
        <em>{Math.round(citation.score * 100)}%</em>
      </div>
      <p>{citation.excerpt}</p>
      {(citation.vectorScore !== undefined || citation.lexicalScore !== undefined) && (
        <div className="score-breakdown">
          {citation.vectorScore !== undefined && <span>vector {Math.round(citation.vectorScore * 100)}%</span>}
          {citation.lexicalScore !== undefined && <span>keyword {Math.round(citation.lexicalScore * 100)}%</span>}
        </div>
      )}
      {citation.matchedTerms?.length ? <small>Matched: {citation.matchedTerms.slice(0, 6).join(", ")}</small> : null}
      {citation.authoredAt && <small>{citation.authoredAt}</small>}
    </>
  );

  if (!citation.uri) {
    return <div className="source-card">{content}</div>;
  }

  return (
    <a className="source-card" href={citation.uri} target="_blank" rel="noreferrer">
      {content}
    </a>
  );
}

function DocumentCard({ document }: { document: SourceDocument }) {
  const content = (
    <>
      <div className="document-card-top">
        <strong>{document.platform}</strong>
        <span>{document.kind}</span>
      </div>
      <p>{document.excerpt}</p>
      <small>
        {document.chunkCount} chunk{document.chunkCount === 1 ? "" : "s"} - {document.tokenCount} tokens
        {document.authoredAt ? ` - ${document.authoredAt}` : ""}
      </small>
    </>
  );

  if (!document.uri) return <div className="document-card">{content}</div>;

  return (
    <a className="document-card" href={document.uri} target="_blank" rel="noreferrer">
      {content}
    </a>
  );
}

function fileIcon(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv")) return <FileSpreadsheet size={17} />;
  if (lower.endsWith(".json") || lower.endsWith(".js")) return <FileJson size={17} />;
  return <FileText size={17} />;
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(exponent ? 1 : 0)} ${units[exponent]}`;
}

function sourcePercent(count: number, total: number): number {
  if (!total) return 0;
  return Math.max(8, Math.round((count / total) * 100));
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function visibleCitations(citations: Citation[]): Array<{ citation: Citation; index: number }> {
  const indexed = citations.map((citation, index) => ({ citation, index }));
  const relevant = indexed.filter(({ citation }) => citation.score > 0.05);
  return (relevant.length ? relevant : indexed).slice(0, 6);
}

function citationCountLabel(citations: Citation[]): string {
  const visible = visibleCitations(citations).length;
  return visible === citations.length ? `${visible} sources` : `${visible}/${citations.length} sources`;
}
