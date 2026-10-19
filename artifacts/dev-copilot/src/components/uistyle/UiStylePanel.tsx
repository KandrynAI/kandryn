import { useCallback, useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, RotateCcw } from "lucide-react";
import {
  fetchUiStyle,
  extractUiStyle,
  updateUiStyle,
  ApiError,
  type UiStyleProfileView,
  type UiStyleToken,
} from "@/services/api";
import {
  evidenceLabel,
  groupColorsByScheme,
  isSettling,
  orderComponents,
  shortRef,
  statusLabel,
  swatchColor,
  type StyleStatus,
} from "@/lib/uiStyleView";

const AMBER = "var(--c-amber, #b4802a)";

/**
 * How this project's interface is already styled (0042).
 *
 * Read-only by design apart from the switch and the UI location: everything
 * shown here was extracted from the repository and carries evidence, so
 * editing a value in Kandryn would make the profile disagree with the code it
 * claims to describe. The swatches render the CUSTOMER's colours as they are —
 * those are data, not Kandryn's palette.
 */
export default function UiStylePanel({ projectId }: { projectId: number }) {
  const { toast } = useToast();
  const [data, setData] = useState<UiStyleProfileView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({ colors: true, components: true });
  /** The fast path must fire once, not on every poll. */
  const [autoStarted, setAutoStarted] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (!Number.isFinite(projectId)) return;
      if (!silent) setLoading(true);
      try {
        setData(await fetchUiStyle(projectId));
        setError(null);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load the UI style profile.");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    load();
  }, [load]);

  const status = (data?.status ?? "none") as StyleStatus;
  const settling = isSettling(status);

  // Fast path: a row queued at project creation would otherwise wait for the
  // five-minute cron. Fired once, and the server's claim makes a double start
  // harmless — the second caller is told the row is busy.
  useEffect(() => {
    if (autoStarted || !data?.canEdit || data.status !== "pending") return;
    setAutoStarted(true);
    extractUiStyle(projectId)
      .then((next) => setData(next))
      .catch(() => void load(true));
  }, [autoStarted, data, projectId, load]);

  useEffect(() => {
    if (!settling) return;
    const t = setTimeout(() => load(true), 3000);
    return () => clearTimeout(t);
  }, [settling, load, data]);

  const onExtract = async () => {
    setBusy(true);
    try {
      setData(await extractUiStyle(projectId));
      toast({ title: "UI style re-read from the repository" });
    } catch (err) {
      toast({
        title: "Could not re-read the repository",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const onPatch = async (body: { enabled?: boolean; uiRoot?: string }) => {
    setBusy(true);
    try {
      setData(await updateUiStyle(projectId, body));
    } catch (err) {
      toast({
        title: "Could not save that change",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm text-muted-foreground">{error ?? "The UI style profile could not be loaded."}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>
          <RotateCcw className="mr-2 h-4 w-4" />Try again
        </Button>
      </div>
    );
  }

  const tokens = data.tokens;
  const { light, dark } = groupColorsByScheme(tokens?.colors ?? []);
  const components = orderComponents(data.components ?? []);

  return (
    <div className="flex flex-col gap-5">
      <p style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-3)" }}>
        How this project's interface is styled. Runs reuse these colors, fonts, components and conventions instead of
        inventing new ones. Read from your repository, never executed.
      </p>

      {/* Status row */}
      <div
        style={{
          border: "1px solid var(--c-border)",
          borderRadius: 6,
          padding: 14,
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: "var(--fs-xs)",
            padding: "2px 9px",
            borderRadius: 999,
            border: `1px solid ${status === "ready" && !data.stale ? "var(--c-border)" : AMBER}`,
            color: status === "ready" && !data.stale ? "var(--c-ink)" : AMBER,
            whiteSpace: "nowrap",
          }}
        >
          {settling && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
          {statusLabel(status, Boolean(data.stale))}
        </span>

        {status === "ready" && (
          <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>
            {data.extractedAt ? new Date(data.extractedAt).toLocaleString() : "—"} · {shortRef(data.sourceRef)} · r
            {data.revision ?? 0}
          </span>
        )}

        <div style={{ flex: 1 }} />

        {data.canEdit && (
          <>
            {(data.uiRootOptions?.length ?? 0) > 1 && (
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>
                UI location
                <select
                  value={data.uiRoot ?? ""}
                  disabled={busy}
                  onChange={(e) => onPatch({ uiRoot: e.target.value })}
                  style={{
                    fontSize: "var(--fs-sm)",
                    padding: "4px 7px",
                    borderRadius: 4,
                    border: "1px solid var(--c-border)",
                    background: "transparent",
                    color: "var(--c-ink)",
                  }}
                >
                  {data.uiRootOptions?.map((r) => (
                    <option key={r} value={r}>{r || "(repository root)"}</option>
                  ))}
                </select>
              </label>
            )}
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--fs-xs)", color: "var(--c-ink-3)" }}>
              <input
                type="checkbox"
                checked={data.enabled !== false}
                disabled={busy}
                onChange={(e) => onPatch({ enabled: e.target.checked })}
              />
              Use this style guide in runs
            </label>
            <Button size="sm" variant="outline" onClick={onExtract} disabled={busy || settling}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
              Re-extract
            </Button>
          </>
        )}
      </div>

      {status === "not_applicable" && (
        <div className="rounded-lg border border-dashed border-border py-14 text-center">
          <p className="text-sm text-muted-foreground">No UI framework was detected in this repository.</p>
          <p className="mt-1 text-xs text-muted-foreground">Runs will continue exactly as before.</p>
        </div>
      )}

      {status === "failed" && (
        <div style={{ border: `1px solid ${AMBER}`, borderRadius: 6, padding: 14, display: "flex", gap: 10 }}>
          <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: AMBER, marginTop: 2 }} />
          <p style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-3)" }}>
            {data.error ?? "The repository could not be read."}
          </p>
        </div>
      )}

      {status === "ready" && (
        <>
          <Section id="framework" title="Framework and styling" open={open} setOpen={setOpen}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[
                data.framework?.ui
                  ? `${data.framework.ui}${data.framework.uiVersion ? ` ${data.framework.uiVersion}` : ""}`
                  : null,
                ...(data.framework?.styling ?? []).map((s) => `${s.name}${s.version ? ` ${s.version}` : ""}`),
                data.framework?.componentLib,
              ]
                .filter(Boolean)
                .map((label) => (
                  <span
                    key={label as string}
                    style={{
                      fontSize: "var(--fs-xs)",
                      padding: "2px 9px",
                      borderRadius: 999,
                      border: "1px solid var(--c-border)",
                      color: "var(--c-ink-2)",
                    }}
                  >
                    {label}
                  </span>
                ))}
              {data.uiRoot ? (
                <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", alignSelf: "center" }}>
                  in {data.uiRoot}
                </span>
              ) : null}
            </div>
          </Section>

          <Section id="colors" title={`Colors (${tokens?.colors.length ?? 0})`} open={open} setOpen={setOpen}>
            {light.length > 0 && <Swatches title={dark.length > 0 ? "Light" : undefined} tokens={light} />}
            {dark.length > 0 && <Swatches title="Dark" tokens={dark} />}
          </Section>

          <Section id="typography" title="Typography" open={open} setOpen={setOpen}>
            <TokenList tokens={tokens?.typography ?? []} />
          </Section>

          <Section id="scale" title="Radius, spacing and shadows" open={open} setOpen={setOpen}>
            <TokenList tokens={[...(tokens?.radius ?? []), ...(tokens?.spacing ?? []), ...(tokens?.shadows ?? [])]} />
          </Section>

          <Section id="components" title={`Components (${components.length})`} open={open} setOpen={setOpen}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-sm)" }}>
                <thead>
                  <tr style={{ color: "var(--c-ink-4)", textAlign: "left" }}>
                    <th style={{ padding: "4px 8px 4px 0", fontWeight: 500 }}>Name</th>
                    <th style={{ padding: "4px 8px", fontWeight: 500 }}>Group</th>
                    <th style={{ padding: "4px 8px", fontWeight: 500 }}>Import</th>
                    <th style={{ padding: "4px 0 4px 8px", fontWeight: 500 }}>Used by</th>
                  </tr>
                </thead>
                <tbody>
                  {components.map((c) => (
                    <tr key={c.path} style={{ borderTop: "1px solid var(--c-border)" }}>
                      <td style={{ padding: "5px 8px 5px 0", color: "var(--c-ink)" }} title={c.path}>
                        {c.name}
                      </td>
                      <td style={{ padding: "5px 8px", color: "var(--c-ink-4)" }}>{c.group}</td>
                      <td style={{ padding: "5px 8px", color: "var(--c-ink-3)", fontFamily: "var(--font-mono, monospace)" }}>
                        {c.importPath}
                      </td>
                      <td style={{ padding: "5px 0 5px 8px", color: "var(--c-ink-4)" }}>
                        {c.usedBy == null ? "not measured" : c.usedBy}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="conventions" title="Conventions" open={open} setOpen={setOpen}>
            <ul style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-3)", lineHeight: 1.8 }}>
              {data.conventions?.classHelper && (
                <li>
                  Class helper: <code>{data.conventions.classHelper.name}</code> from{" "}
                  <code>{data.conventions.classHelper.importPath}</code>
                </li>
              )}
              {data.conventions?.iconLibrary && <li>Icons: {data.conventions.iconLibrary}</li>}
              {(data.conventions?.primitives?.length ?? 0) > 0 && (
                <li>Primitives: {data.conventions?.primitives?.join(", ")}</li>
              )}
              {data.conventions?.fileNaming && <li>File naming: {data.conventions.fileNaming}</li>}
              {data.conventions?.theming && <li>Theming: {data.conventions.theming}</li>}
              {data.conventions?.layoutShell && <li>Layout shell: {data.conventions.layoutShell}</li>}
            </ul>
          </Section>

          {(data.exemplars?.length ?? 0) > 0 && (
            <Section id="exemplars" title="Example files" open={open} setOpen={setOpen}>
              <ul style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-3)", lineHeight: 1.8 }}>
                {data.exemplars?.map((e) => (
                  <li key={e.path} style={{ fontFamily: "var(--font-mono, monospace)" }}>{e.path}</li>
                ))}
              </ul>
            </Section>
          )}

          {(data.warnings?.length ?? 0) > 0 && (
            <Section id="warnings" title={`Notes (${data.warnings?.length})`} open={open} setOpen={setOpen}>
              <ul style={{ fontSize: "var(--fs-sm)", color: AMBER, lineHeight: 1.8 }}>
                {data.warnings?.map((w) => <li key={w}>{w}</li>)}
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function Section({
  id,
  title,
  open,
  setOpen,
  children,
}: {
  id: string;
  title: string;
  open: Record<string, boolean>;
  setOpen: (f: (o: Record<string, boolean>) => Record<string, boolean>) => void;
  children: React.ReactNode;
}) {
  const isOpen = open[id] ?? false;
  return (
    <div style={{ border: "1px solid var(--c-border)", borderRadius: 6 }}>
      <button
        onClick={() => setOpen((o) => ({ ...o, [id]: !isOpen }))}
        aria-expanded={isOpen}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          background: "none",
          border: "none",
          padding: "10px 14px",
          cursor: "pointer",
          fontSize: "var(--fs-sm)",
          fontWeight: 600,
          color: "var(--c-ink)",
          textAlign: "left",
        }}
      >
        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {title}
      </button>
      {isOpen && <div style={{ padding: "0 14px 14px" }}>{children}</div>}
    </div>
  );
}

/** The customer's own colours, shown as they are. */
function Swatches({ title, tokens }: { title?: string; tokens: UiStyleToken[] }) {
  return (
    <div style={{ marginBottom: 10 }}>
      {title && (
        <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", marginBottom: 6 }}>{title}</div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {tokens.map((t) => {
          const paint = swatchColor(t.value);
          return (
            <div
              key={`${t.scope ?? ""}${t.name}`}
              title={`${t.name}: ${t.value}  —  ${evidenceLabel(t.source)}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                border: "1px solid var(--c-border)",
                borderRadius: 4,
                padding: "4px 8px",
                fontSize: "var(--fs-xs)",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  border: "1px solid var(--c-border)",
                  background: paint ?? "transparent",
                }}
              />
              <span style={{ color: "var(--c-ink-2)", fontFamily: "var(--font-mono, monospace)" }}>{t.name}</span>
              <span style={{ color: "var(--c-ink-4)" }}>{t.value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TokenList({ tokens }: { tokens: UiStyleToken[] }) {
  if (tokens.length === 0) {
    return <p style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-4)" }}>None found.</p>;
  }
  return (
    <ul style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-3)", lineHeight: 1.8 }}>
      {tokens.map((t) => (
        <li key={`${t.scope ?? ""}${t.name}${t.value}`} title={evidenceLabel(t.source)}>
          <code style={{ color: "var(--c-ink-2)" }}>{t.name}</code> — {t.value}
        </li>
      ))}
    </ul>
  );
}
