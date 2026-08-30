import { useEffect, useMemo, useRef, useState } from "react";
import { agentDisplay } from "@/lib/agents";
import { bandFor, formatElapsed, makeRotation } from "./generationCopy";

/**
 * The in-progress view for a running generation.
 *
 * Deliberately has no percentage. The backend reports no stage or progress —
 * `runs` carries status and startedAt and nothing between — so a filling bar
 * would be inventing a number. Both agent bars are indeterminate shimmers, and
 * the only quantity shown is elapsed time, which is real.
 *
 * Rendered only while the run is actually running. The failed/canceled branches
 * are separate nodes that never mount this, so the rotating copy cannot appear
 * beside an error.
 */

/** Both generation agents run in parallel (AIOrchestrator.generateSuggestions). */
const AGENTS = ["claude", "openai"] as const;
/** Long enough to read, short enough not to feel frozen. */
const ROTATE_MS = 12_000;

interface Props {
  /** Files from the approved plan. Empty before planning lands. */
  plannedPaths: string[];
  /** ISO timestamp the run started; null until executeRun sets it. */
  startedAt: string | null;
  /** e.g. "C# / .NET 8" — from runs.stack_desc. */
  stackDesc?: string | null;
  /** Whether the graph retrieval path was used for context. */
  usedGraph?: boolean;
}

export function GeneratingProgress({ plannedPaths, startedAt, stackDesc, usedGraph }: Props) {
  const [elapsed, setElapsed] = useState(() => secondsSince(startedAt));

  // Ticks locally off startedAt — no extra requests just to move a clock.
  useEffect(() => {
    setElapsed(secondsSince(startedAt));
    const id = setInterval(() => setElapsed(secondsSince(startedAt)), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const band = bandFor(elapsed);
  const [line, setLine] = useState("");
  const rotate = useRef<(() => string) | null>(null);

  // A new band starts its own rotation, so crossing 30s or 2m changes the tone
  // immediately rather than after the current line times out.
  useEffect(() => {
    rotate.current = makeRotation(band.lines);
    setLine(rotate.current());
    const id = setInterval(() => setLine(rotate.current!()), ROTATE_MS);
    return () => clearInterval(id);
  }, [band]);

  const fileLabel = useMemo(() => {
    if (plannedPaths.length === 0) return null;
    return plannedPaths.map(basename).join(" · ");
  }, [plannedPaths]);

  const facts = [stackDesc, usedGraph ? "graph context" : null].filter(Boolean) as string[];

  return (
    <div style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ---- What is happening, and for how long ---- */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div style={{ fontSize: "var(--fs-base)", fontWeight: 600, color: "var(--c-ink)" }}>
          {plannedPaths.length > 0
            ? `Implementing ${plannedPaths.length} file${plannedPaths.length === 1 ? "" : "s"}`
            : "Reading the repository"}
        </div>
        <div
          style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-sm)", color: "var(--c-ink-3)" }}
          aria-label={`${elapsed} seconds elapsed`}
        >
          {formatElapsed(elapsed)}
        </div>
      </div>

      {fileLabel && (
        <div style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-sm)", color: "var(--c-ink-2)", lineHeight: 1.6, wordBreak: "break-word" }}>
          {fileLabel}
        </div>
      )}

      {facts.length > 0 && (
        <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-4)" }}>{facts.join(" · ")}</div>
      )}

      {/* ---- Both agents, side by side: they are racing, and that matters ---- */}
      <div style={{ display: "flex", gap: 12 }}>
        {AGENTS.map((agent) => {
          const d = agentDisplay(agent);
          return (
            <div key={agent} style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, gap: 8 }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-sm)", color: "var(--c-ink-2)" }}>{d.name}</span>
                <span style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-4)" }}>running</span>
              </div>
              {/* Indeterminate on purpose: a sliding highlight cannot be misread as
                  "62% done" the way a filling bar can. */}
              <div style={{ height: 4, background: "var(--c-raised)", borderRadius: 2, overflow: "hidden" }}>
                <div
                  style={{
                    height: 4,
                    width: "40%",
                    borderRadius: 2,
                    background: d.colour,
                    animation: "indeterminate 1.6s ease-in-out infinite",
                    // Offset so the two bars don't move in lockstep.
                    animationDelay: agent === "openai" ? "0.5s" : "0s",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-3)", lineHeight: 1.5 }}>
        Both agents are writing against the same plan. Synthesia scores them when they land.
      </div>

      {/* ---- Seasoning. Quieter than everything above it, and never load-bearing ---- */}
      <div
        style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-4)", fontStyle: "italic", minHeight: 20, lineHeight: 1.5 }}
        aria-live="off"
      >
        {line}
      </div>
    </div>
  );
}

function secondsSince(iso: string | null): number {
  if (!iso) return 0;
  const started = new Date(iso).getTime();
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.floor((Date.now() - started) / 1000));
}

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}
