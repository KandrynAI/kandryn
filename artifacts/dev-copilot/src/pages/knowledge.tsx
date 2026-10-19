import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Upload, Trash2, Loader2, FileText, AlertTriangle, RotateCcw } from "lucide-react";
import {
  fetchProject,
  fetchKnowledge,
  requestKnowledgeUpload,
  completeKnowledgeUpload,
  deleteKnowledgeSource,
  putToSignedUrl,
  ApiError,
  type Project,
  type KnowledgeList,
  type KnowledgeSource,
  type KnowledgeDocType,
} from "@/services/api";

const DOC_TYPES: Array<{ value: KnowledgeDocType; label: string }> = [
  { value: "architecture", label: "Architecture" },
  { value: "requirements", label: "Business requirements" },
  { value: "design", label: "Design" },
  { value: "other", label: "Other" },
];

const ACCEPT = ".md,.txt,.csv,.pdf,.docx";
const MAX_SIZE_BYTES = 15 * 1024 * 1024;

/**
 * Status styling. Neutral and amber only — a document that failed to parse is
 * a caution, not an error in the product, and red here would read as breakage.
 */
const STATUS_STYLE: Record<KnowledgeSource["status"], { label: string; color: string; border: string }> = {
  pending: { label: "Uploading", color: "var(--c-ink-3)", border: "var(--c-border)" },
  parsing: { label: "Indexing", color: "var(--c-ink-3)", border: "var(--c-border)" },
  ready: { label: "Ready", color: "var(--c-ink)", border: "var(--c-border)" },
  failed: { label: "Not indexed", color: "var(--c-amber, #b4802a)", border: "var(--c-amber, #b4802a)" },
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function KnowledgePage() {
  const params = useParams<{ projectId: string }>();
  const projectId = Number(params.projectId);
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [project, setProject] = useState<Project | null>(null);
  const [data, setData] = useState<KnowledgeList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<KnowledgeDocType>("requirements");
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!Number.isFinite(projectId)) return;
      if (!silent) setLoading(true);
      try {
        const [p, k] = await Promise.all([fetchProject(projectId), fetchKnowledge(projectId)]);
        setProject(p);
        setData(k);
        setError(null);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load documents.");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    load();
  }, [load]);

  const onUpload = async () => {
    if (!file) return;
    setUploadError(null);
    if (file.size > MAX_SIZE_BYTES) {
      setUploadError("That file is larger than 15 MB.");
      return;
    }
    setUploading(true);
    try {
      // Three steps: ask for a signed URL, PUT the bytes straight to storage,
      // then tell the server to verify and index what landed.
      const { sourceId, uploadUrl } = await requestKnowledgeUpload(projectId, {
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        docType,
        title: title.trim() || undefined,
      });
      await putToSignedUrl(uploadUrl, file);
      const done = await completeKnowledgeUpload(projectId, sourceId);
      toast({
        title: "Document added",
        description: done.error ?? `Indexed in ${done.chunkCount} passage${done.chunkCount === 1 ? "" : "s"}.`,
      });
      setFile(null);
      setTitle("");
      if (fileInput.current) fileInput.current.value = "";
      await load(true);
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : "The upload did not finish.");
      await load(true);
    } finally {
      setUploading(false);
    }
  };

  const onDelete = async (source: KnowledgeSource) => {
    if (!window.confirm(`Remove "${source.title}"? Runs will no longer use it as background.`)) return;
    setDeletingId(source.id);
    try {
      await deleteKnowledgeSource(projectId, source.id);
      toast({ title: "Document removed" });
      await load(true);
    } catch (err) {
      toast({
        title: "Could not remove the document",
        description: err instanceof ApiError ? err.message : "Something went wrong.",
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-5 py-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-28 w-full" />
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 px-5 py-16 text-center">
        <p className="text-sm text-muted-foreground">{error ?? "Documents could not be loaded."}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>
          <RotateCcw className="mr-2 h-4 w-4" />Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-5 py-6">
      <div>
        <Link href={`/p/${projectId}/board`}>
          <Button variant="ghost" size="sm" className="-ml-2">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {project?.name ?? "Board"}
          </Button>
        </Link>
      </div>

      <div>
        <h1 style={{ fontSize: "var(--fs-xl)", fontWeight: 600, color: "var(--c-ink)" }}>Project knowledge</h1>
        <p style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-3)", marginTop: 4 }}>
          Documents Kandryn can use as background when it runs work items in this project. Reference only. Do not
          upload credentials.
        </p>
      </div>

      {!data.storageConfigured ? (
        <div
          style={{
            border: "1px solid var(--c-border)",
            borderRadius: 6,
            padding: 16,
            fontSize: "var(--fs-sm)",
            color: "var(--c-ink-3)",
          }}
        >
          Document storage is not configured.
        </div>
      ) : data.canUpload ? (
        <div style={{ border: "1px solid var(--c-border)", borderRadius: 6, padding: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              disabled={uploading}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setUploadError(null);
              }}
              style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-2)" }}
            />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <select
                value={docType}
                disabled={uploading}
                onChange={(e) => setDocType(e.target.value as KnowledgeDocType)}
                style={{
                  fontSize: "var(--fs-sm)",
                  padding: "5px 8px",
                  borderRadius: 4,
                  border: "1px solid var(--c-border)",
                  background: "var(--c-surface, transparent)",
                  color: "var(--c-ink)",
                }}
              >
                {DOC_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={title}
                disabled={uploading}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title (optional)"
                style={{
                  fontSize: "var(--fs-sm)",
                  padding: "5px 8px",
                  borderRadius: 4,
                  border: "1px solid var(--c-border)",
                  background: "transparent",
                  color: "var(--c-ink)",
                  flex: "1 1 180px",
                }}
              />
              <Button size="sm" onClick={onUpload} disabled={!file || uploading}>
                {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                {uploading ? "Uploading…" : "Upload"}
              </Button>
            </div>
            <p style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>
              .md, .txt, .csv, .pdf or .docx, up to 15 MB.
            </p>
            {uploadError && (
              <p style={{ fontSize: "var(--fs-sm)", color: "var(--c-amber, #b4802a)", display: "flex", gap: 6 }}>
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {uploadError}
              </p>
            )}
          </div>
        </div>
      ) : null}

      {data.sources.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">No documents yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add an architecture or requirements document to give runs more background.
          </p>
        </div>
      ) : (
        <div style={{ border: "1px solid var(--c-border)", borderRadius: 6, overflow: "hidden" }}>
          {data.sources.map((s, i) => {
            const style = STATUS_STYLE[s.status];
            return (
              <div
                key={s.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: "12px 14px",
                  borderTop: i === 0 ? "none" : "1px solid var(--c-border)",
                }}
              >
                <FileText className="h-4 w-4 shrink-0" style={{ color: "var(--c-ink-4)", marginTop: 2 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "var(--fs-base)", color: "var(--c-ink)", fontWeight: 500 }}>{s.title}</div>
                  <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", marginTop: 2 }}>
                    {DOC_TYPES.find((t) => t.value === s.docType)?.label ?? s.docType} · {s.fileName} ·{" "}
                    {formatSize(s.sizeBytes)}
                    {s.status === "ready" && ` · ${s.chunkCount} passage${s.chunkCount === 1 ? "" : "s"}`}
                  </div>
                  {s.error && (
                    <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-amber, #b4802a)", marginTop: 4 }}>
                      {s.error}
                    </div>
                  )}
                </div>
                <span
                  style={{
                    fontSize: "var(--fs-xs)",
                    padding: "2px 8px",
                    borderRadius: 999,
                    border: `1px solid ${style.border}`,
                    color: style.color,
                    whiteSpace: "nowrap",
                  }}
                >
                  {style.label}
                </span>
                {data.canUpload && (
                  <button
                    onClick={() => onDelete(s)}
                    disabled={deletingId === s.id}
                    title="Remove document"
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--c-ink-4)", padding: 2 }}
                  >
                    {deletingId === s.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
