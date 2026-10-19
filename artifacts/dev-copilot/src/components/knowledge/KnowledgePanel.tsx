import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Upload, Trash2, Loader2, Pencil, X, AlertTriangle, RotateCcw, ArrowUp, ArrowDown } from "lucide-react";
import {
  fetchKnowledge,
  requestKnowledgeUpload,
  completeKnowledgeUpload,
  updateKnowledgeSource,
  deleteKnowledgeSource,
  putToSignedUrl,
  ApiError,
  type KnowledgeList,
  type KnowledgeSource,
  type KnowledgeDocType,
} from "@/services/api";
import {
  MAX_SOURCES_PER_PROJECT,
  displayFileName,
  nextToStart,
  queueReducer,
  sortSources,
  uploadableCount,
  type QueueItem,
  type SortDir,
  type SortKey,
} from "@/lib/knowledgeQueue";

const DOC_TYPES: Array<{ value: KnowledgeDocType; label: string }> = [
  { value: "architecture", label: "Architecture" },
  { value: "requirements", label: "Business requirements" },
  { value: "design", label: "Design" },
  { value: "other", label: "Other" },
];
const typeLabel = (v: string) => DOC_TYPES.find((t) => t.value === v)?.label ?? v;

const ACCEPT = ".md,.txt,.csv,.pdf,.docx";
/** Storage problems an operator must fix; the add area is useless until then. */
const BLOCKING_CODES = new Set(["STORAGE_BUCKET_MISSING", "STORAGE_AUTH", "STORAGE_NOT_CONFIGURED"]);

const AMBER = "var(--c-amber, #b4802a)";

/**
 * Status wording. Neutral for Ready, amber for everything else — a document
 * that did not index is a caution, not a failure of the product, and red here
 * would read as breakage.
 */
const STATUS_STYLE: Record<KnowledgeSource["status"], { label: string; color: string }> = {
  pending: { label: "Pending", color: AMBER },
  parsing: { label: "Processing", color: AMBER },
  ready: { label: "Ready", color: "var(--c-ink)" },
  failed: { label: "Failed", color: AMBER },
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const inputStyle: React.CSSProperties = {
  fontSize: "var(--fs-sm)",
  padding: "5px 8px",
  borderRadius: 4,
  border: "1px solid var(--c-border)",
  background: "transparent",
  color: "var(--c-ink)",
};

const iconButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "none",
  border: "none",
  padding: 4,
  borderRadius: 4,
  cursor: "pointer",
  color: "var(--c-ink-4)",
};

/**
 * Project knowledge: a multi-file upload queue and a table of what is stored.
 *
 * Uploads go browser → bucket directly through a signed URL, three at a time,
 * each row reporting its own progress. One file failing never cancels the
 * others, and a failed row stays put so it can be retried — a batch that
 * silently drops a file is worse than one that says which file it dropped.
 *
 * `welcome` is driven ONLY by the ?welcome=1 URL flag the post-create
 * navigation sets. Nothing is persisted.
 */
export default function KnowledgePanel({ projectId, welcome = false }: { projectId: number; welcome?: boolean }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadArea = useRef<HTMLDivElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);

  const [data, setData] = useState<KnowledgeList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** A storage misconfiguration, shown as a banner until it is fixed. */
  const [storageIssue, setStorageIssue] = useState<{ code: string; message: string } | null>(null);

  const [queue, dispatch] = useReducer(queueReducer, [] as QueueItem[]);
  const [batchType, setBatchType] = useState<KnowledgeDocType>("requirements");
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);

  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [editing, setEditing] = useState<KnowledgeSource | null>(null);
  const [deleting, setDeleting] = useState<KnowledgeSource | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!Number.isFinite(projectId)) return;
      if (!silent) setLoading(true);
      try {
        setData(await fetchKnowledge(projectId));
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

  const sources = data?.sources ?? [];
  const settling = sources.some((s) => s.status === "pending" || s.status === "parsing");

  // Poll only while something is still being indexed, then stop.
  useEffect(() => {
    if (!settling) return;
    const t = setTimeout(() => load(true), 3000);
    return () => clearTimeout(t);
  }, [settling, load, sources]);

  const toBoard = useCallback(() => navigate(`/p/${projectId}/board`), [navigate, projectId]);

  useEffect(() => {
    if (welcome && data && !data.storageConfigured) toBoard();
  }, [welcome, data, toBoard]);

  const focusUpload = () => {
    uploadArea.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    chooseButton.current?.focus();
  };

  const addFiles = (files: FileList | File[] | null) => {
    if (!files) return;
    const list = Array.from(files);
    if (list.length === 0) return;
    dispatch({ type: "add", files: list, docType: batchType, existingCount: sources.length });
  };

  /** One file, end to end: signed URL, PUT with progress, then index. */
  const runOne = useCallback(
    async (item: QueueItem) => {
      dispatch({ type: "start", id: item.id });
      try {
        const { sourceId, uploadUrl } = await requestKnowledgeUpload(projectId, {
          fileName: item.fileName,
          mimeType: item.file.type || "application/octet-stream",
          sizeBytes: item.sizeBytes,
          docType: item.docType,
          title: item.title.trim() || undefined,
        });
        dispatch({ type: "start", id: item.id, sourceId });
        await putToSignedUrl(uploadUrl, item.file, (p) => dispatch({ type: "progress", id: item.id, progress: p }));
        dispatch({ type: "processing", id: item.id });
        const done = await completeKnowledgeUpload(projectId, sourceId);
        dispatch({ type: "done", id: item.id });
        if (done.error) {
          toast({ title: `${item.fileName} was indexed in part`, description: done.error });
        }
      } catch (err) {
        const body = err instanceof ApiError ? (err.body as { code?: string; error?: string } | undefined) : undefined;
        if (body?.code && BLOCKING_CODES.has(body.code)) {
          setStorageIssue({ code: body.code, message: body.error ?? "Document storage is not available." });
        }
        dispatch({
          type: "failed",
          id: item.id,
          error: err instanceof ApiError ? err.message : "The upload did not finish.",
        });
      }
    },
    [projectId, toast],
  );

  // The pump: start whatever the concurrency bound allows, and stop when the
  // queue has nothing left to run.
  useEffect(() => {
    if (!running) return;
    const starting = nextToStart(queue);
    if (starting.length > 0) {
      for (const item of starting) void runOne(item);
      return;
    }
    const busy = queue.some((i) => i.state === "uploading" || i.state === "processing" || i.state === "queued");
    if (!busy) {
      setRunning(false);
      dispatch({ type: "clearFinished" });
      void load(true);
    }
  }, [running, queue, runOne, load]);

  const onEditSave = async (patch: { title: string; docType: KnowledgeDocType }, newFile: File | null) => {
    if (!editing) return;
    const target = editing;
    try {
      if (newFile) {
        // Replace: upload and index the new file first; the server removes the
        // old document only once the new one is ready.
        const { sourceId, uploadUrl } = await requestKnowledgeUpload(projectId, {
          fileName: newFile.name,
          mimeType: newFile.type || "application/octet-stream",
          sizeBytes: newFile.size,
          docType: patch.docType,
          title: patch.title.trim() || undefined,
          replaceSourceId: target.id,
        });
        await putToSignedUrl(uploadUrl, newFile);
        await completeKnowledgeUpload(projectId, sourceId, target.id);
        toast({ title: "Document replaced" });
      } else {
        await updateKnowledgeSource(projectId, target.id, { title: patch.title.trim(), docType: patch.docType });
        toast({ title: "Document updated" });
      }
      setEditing(null);
      await load(true);
      return;
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { code?: string; error?: string } | undefined) : undefined;
      if (body?.code && BLOCKING_CODES.has(body.code)) {
        setStorageIssue({ code: body.code, message: body.error ?? "Document storage is not available." });
      }
      // The old document is untouched, so say so rather than implying loss.
      throw new Error(err instanceof ApiError ? err.message : "The change could not be saved.");
    }
  };

  const onConfirmDelete = async () => {
    if (!deleting) return;
    const target = deleting;
    try {
      await deleteKnowledgeSource(projectId, target.id);
      toast({ title: "Document deleted" });
      setDeleting(null);
      await load(true);
    } catch (err) {
      toast({
        title: "Could not delete the document",
        description: err instanceof ApiError ? err.message : "Something went wrong.",
        variant: "destructive",
      });
    }
  };

  const rows = useMemo(() => sortSources(sources, sortKey, sortDir), [sources, sortKey, sortDir]);
  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "createdAt" ? "desc" : "asc");
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-28 w-full" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm text-muted-foreground">{error ?? "Documents could not be loaded."}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>
          <RotateCcw className="mr-2 h-4 w-4" />Try again
        </Button>
      </div>
    );
  }

  const blocked = Boolean(storageIssue && BLOCKING_CODES.has(storageIssue.code)) || !data.storageConfigured;
  const showWelcome = welcome && data.storageConfigured && !blocked;
  const pendingCount = uploadableCount(queue);

  return (
    <div className="flex flex-col gap-5">
      <p style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-3)" }}>
        Documents Kandryn can use as background when it runs work items in this project. Reference only. Do not
        upload credentials.
      </p>

      {/* Storage problem: the operator's message, and the add area goes away */}
      {(storageIssue || !data.storageConfigured) && (
        <div
          role="status"
          style={{ border: `1px solid ${AMBER}`, borderRadius: 6, padding: 14, display: "flex", gap: 10 }}
        >
          <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: AMBER, marginTop: 2 }} />
          <div>
            <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink)", fontWeight: 600 }}>
              Documents cannot be uploaded right now
            </div>
            <p style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-3)", marginTop: 4 }}>
              {storageIssue?.message ?? "Document storage is not configured."}
            </p>
          </div>
        </div>
      )}

      {showWelcome && (
        <div style={{ border: "1px solid var(--c-border)", borderRadius: 6, padding: 16 }}>
          <div style={{ fontSize: "var(--fs-base)", fontWeight: 600, color: "var(--c-ink)" }}>
            Add project documents (optional)
          </div>
          <p style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-3)", marginTop: 6, lineHeight: 1.6 }}>
            Architecture, requirements or design documents give Kandryn background when it runs work items here. You
            can add them now or any time from Project settings.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12 }}>
            <Button size="sm" onClick={toBoard}>
              {sources.length > 0 ? "Continue to board" : "Skip for now"}
            </Button>
            {data.canUpload && (
              <button
                onClick={focusUpload}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  fontSize: "var(--fs-sm)",
                  color: "var(--c-ink-3)",
                  textDecoration: "underline",
                }}
              >
                Add documents
              </button>
            )}
          </div>
        </div>
      )}

      {/* A. Add documents */}
      {data.canUpload && !blocked && (
        <div ref={uploadArea} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            multiple
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
            style={{ display: "none" }}
          />
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              addFiles(e.dataTransfer.files);
            }}
            style={{
              border: `1px dashed ${dragging ? "var(--c-blue)" : "var(--c-border)"}`,
              background: dragging ? "var(--c-blue-bg, rgba(25,195,154,0.06))" : "transparent",
              borderRadius: 6,
              padding: 20,
              textAlign: "center",
            }}
          >
            <p style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-3)" }}>
              Drop files here, or
            </p>
            <Button
              ref={chooseButton}
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => fileInput.current?.click()}
            >
              <Upload className="mr-2 h-4 w-4" />Choose files
            </Button>
            <p style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", marginTop: 8 }}>
              .md, .txt, .csv, .pdf or .docx, up to 15 MB each. {sources.length} of {MAX_SOURCES_PER_PROJECT} used.
            </p>
          </div>

          {queue.length > 0 && (
            <div style={{ border: "1px solid var(--c-border)", borderRadius: 6, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                <label style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>Type for all</label>
                <select
                  value={batchType}
                  onChange={(e) => {
                    const v = e.target.value as KnowledgeDocType;
                    setBatchType(v);
                    dispatch({ type: "setDocTypeAll", docType: v });
                  }}
                  style={inputStyle}
                >
                  {DOC_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                <div style={{ flex: 1 }} />
                <Button size="sm" onClick={() => setRunning(true)} disabled={pendingCount === 0 || running}>
                  {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                  {running ? "Uploading…" : `Upload ${pendingCount} file${pendingCount === 1 ? "" : "s"}`}
                </Button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {queue.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                      borderTop: "1px solid var(--c-border)",
                      paddingTop: 8,
                    }}
                  >
                    <span
                      title={item.fileName}
                      style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink)", minWidth: 150 }}
                    >
                      {displayFileName(item.fileName)}
                    </span>
                    <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>
                      {formatSize(item.sizeBytes)}
                    </span>
                    {item.state === "queued" || item.state === "invalid" || item.state === "failed" ? (
                      <>
                        <select
                          value={item.docType}
                          onChange={(e) =>
                            dispatch({ type: "setDocType", id: item.id, docType: e.target.value as KnowledgeDocType })
                          }
                          disabled={item.state === "invalid"}
                          style={inputStyle}
                        >
                          {DOC_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={item.title}
                          onChange={(e) => dispatch({ type: "setTitle", id: item.id, title: e.target.value })}
                          disabled={item.state === "invalid"}
                          placeholder="Title"
                          style={{ ...inputStyle, flex: "1 1 140px" }}
                        />
                      </>
                    ) : (
                      <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-3)", flex: "1 1 140px" }}>
                        {item.state === "uploading"
                          ? `Uploading ${item.progress}%`
                          : item.state === "processing"
                            ? "Processing…"
                            : "Done"}
                      </span>
                    )}
                    {item.state === "uploading" && (
                      <div style={{ flexBasis: "100%" }}>
                        <Progress value={item.progress} className="h-1" />
                      </div>
                    )}
                    {item.state === "failed" && (
                      <button
                        onClick={() => {
                          dispatch({ type: "retry", id: item.id });
                          setRunning(true);
                        }}
                        style={{ ...iconButtonStyle, color: "var(--c-ink-3)", fontSize: "var(--fs-xs)", gap: 4 }}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />Retry
                      </button>
                    )}
                    <button
                      onClick={() => dispatch({ type: "remove", id: item.id })}
                      title="Remove from the queue"
                      aria-label={`Remove ${item.fileName} from the queue`}
                      style={iconButtonStyle}
                      disabled={item.state === "uploading" || item.state === "processing"}
                    >
                      <X className="h-4 w-4" />
                    </button>
                    {item.error && (
                      <p style={{ flexBasis: "100%", fontSize: "var(--fs-xs)", color: AMBER, display: "flex", gap: 5 }}>
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        {item.error}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* B. Documents table */}
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">No documents yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add an architecture or requirements document to give runs more background.
          </p>
        </div>
      ) : (
        <div style={{ border: "1px solid var(--c-border)", borderRadius: 6, overflowX: "auto" }}>
          <Table>
            <TableHeader>
              <TableRow>
                <SortHeader label="Title" k="title" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Type" k="docType" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <TableHead>File</TableHead>
                <SortHeader label="Size" k="sizeBytes" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <TableHead>Status</TableHead>
                <TableHead>Chunks</TableHead>
                <SortHeader label="Added" k="createdAt" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                {data.canUpload && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => {
                const style = STATUS_STYLE[s.status];
                return (
                  <TableRow key={s.id}>
                    <TableCell style={{ color: "var(--c-ink)", fontWeight: 500 }}>{s.title}</TableCell>
                    <TableCell style={{ color: "var(--c-ink-3)" }}>{typeLabel(s.docType)}</TableCell>
                    <TableCell style={{ color: "var(--c-ink-3)" }} title={s.fileName}>
                      {displayFileName(s.fileName, 24)}
                    </TableCell>
                    <TableCell style={{ color: "var(--c-ink-3)" }}>{formatSize(s.sizeBytes)}</TableCell>
                    <TableCell>
                      <span title={s.error ?? undefined} style={{ color: style.color, fontSize: "var(--fs-xs)" }}>
                        {style.label}
                      </span>
                      {s.error && (
                        <span
                          className="block md:hidden"
                          style={{ fontSize: "var(--fs-xs)", color: AMBER, marginTop: 2 }}
                        >
                          {s.error}
                        </span>
                      )}
                    </TableCell>
                    <TableCell style={{ color: "var(--c-ink-3)" }}>{s.status === "ready" ? s.chunkCount : "—"}</TableCell>
                    <TableCell style={{ color: "var(--c-ink-3)", whiteSpace: "nowrap" }}>
                      {new Date(s.createdAt).toLocaleDateString()}
                    </TableCell>
                    {data.canUpload && (
                      <TableCell className="text-right" style={{ whiteSpace: "nowrap" }}>
                        <button
                          onClick={() => setEditing(s)}
                          title="Change this document"
                          aria-label={`Change ${s.title}`}
                          style={iconButtonStyle}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setDeleting(s)}
                          title="Delete this document"
                          aria-label={`Delete ${s.title}`}
                          style={iconButtonStyle}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {editing && (
        <EditDialog source={editing} onClose={() => setEditing(null)} onSave={onEditSave} />
      )}

      <AlertDialog open={deleting != null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the document and what was extracted from it. Runs already started are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {/* Neutral, not destructive-red: this is a reversible housekeeping
                action, and the palette reserves red for nothing here. */}
            <AlertDialogAction onClick={onConfirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SortHeader({
  label,
  k,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  const active = k === sortKey;
  return (
    <TableHead>
      <button
        onClick={() => onSort(k)}
        aria-label={`Sort by ${label}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          font: "inherit",
          color: active ? "var(--c-ink)" : "inherit",
        }}
      >
        {label}
        {active && (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </TableHead>
  );
}

/** C. Change: rename, retype, and optionally replace the file. */
function EditDialog({
  source,
  onClose,
  onSave,
}: {
  source: KnowledgeSource;
  onClose: () => void;
  onSave: (patch: { title: string; docType: KnowledgeDocType }, newFile: File | null) => Promise<void>;
}) {
  const [title, setTitle] = useState(source.title);
  const [docType, setDocType] = useState<KnowledgeDocType>(source.docType);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!title.trim()) {
      setErr("A title is required.");
      return;
    }
    setSaving(true);
    try {
      await onSave({ title, docType }, file);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "The change could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change document</DialogTitle>
          <DialogDescription>
            Rename it, change its type, or replace the file itself.
          </DialogDescription>
        </DialogHeader>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", display: "block", marginBottom: 4 }}>
              Title
            </label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} style={{ ...inputStyle, width: "100%" }} />
          </div>
          <div>
            <label style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", display: "block", marginBottom: 4 }}>
              Document type
            </label>
            <select value={docType} onChange={(e) => setDocType(e.target.value as KnowledgeDocType)} style={inputStyle}>
              {DOC_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", display: "block", marginBottom: 4 }}>
              Replace file (optional)
            </label>
            <p style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-3)", marginBottom: 6 }}>
              Current: {source.fileName} · {formatSize(source.sizeBytes)}
            </p>
            <input
              type="file"
              accept={ACCEPT}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-2)" }}
            />
            <p style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", marginTop: 6 }}>
              The current document stays in place until the new file has been indexed.
            </p>
          </div>
          {err && (
            <p style={{ fontSize: "var(--fs-sm)", color: AMBER, display: "flex", gap: 6 }}>
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {err}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {saving ? (file ? "Replacing…" : "Saving…") : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
