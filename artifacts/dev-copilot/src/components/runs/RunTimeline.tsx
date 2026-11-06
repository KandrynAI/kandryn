import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, ArrowDown } from "lucide-react";
import { fetchRunEvents, ApiError, type RunEvent, type RunStatus } from "@/services/api";
import {
  agentLabel,
  cursorOf,
  elapsedMs,
  formatClock,
  formatDuration,
  groupEvents,
  groupSummary,
  isMonoType,
  mergeEvents,
  pollIntervalMs,
  shouldPoll,
  startsCollapsed,
  statusGlyph,
  statusTone,
  type TimelineGroup,
} from "@/lib/runTimeline";

/**
 * The live run timeline (0044 PR3).
 *
 * Owns its own fetching and polling so the run page drops it in with a run id
 * and nothing else. All of the ordering, merging, grouping and collapse logic
 * lives in `lib/runTimeline.ts`, where it can be tested — this file is markup,
 * scroll behaviour and timers.
 *
 * A finished run renders the same way from stored events: same component, no
 * polling, nothing highlighted.
 */

const TONE_COLOR: Record<ReturnType<typeof statusTone>, string> = {
  muted: "var(--c-ink-4)",
  ok: "var(--c-green)",
  // Amber for both warn and failed, deliberately: a step that needs attention
  // is a caution, and red is reserved elsewhere in this app.
  attention: "var(--c-amber)",
};

/** Within this many pixels of the bottom counts as "following". */
const PIN_SLACK_PX = 40;

export default function RunTimeline({
  runId,
  initialStatus,
}: {
  runId: number;
  initialStatus: RunStatus;
}) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [runStatus, setRunStatus] = useState<RunStatus>(initialStatus);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // Groups the reader has opened or closed by hand. Their choice wins over the
  // default, which otherwise re-collapses a group the moment it finishes.
  const touched = useRef<Set<string>>(new Set());
  const [pinned, setPinned] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  const scroller = useRef<HTMLDivElement | null>(null);
  // Read inside the poll without making it a dependency, so the interval is not
  // torn down and rebuilt on every page.
  const cursor = useRef(0);

  const load = useCallback(async () => {
    try {
      const page = await fetchRunEvents(runId, cursor.current);
      setRunStatus(page.runStatus);
      if (page.events.length > 0) {
        setEvents((prev) => {
          const merged = mergeEvents(prev, page.events);
          cursor.current = cursorOf(merged);
          return merged;
        });
      }
      setError(null);
    } catch (err) {
      // A failed poll keeps the timeline on screen; the next tick retries. Only
      // the very first load is allowed to show an error, because there is
      // nothing else to show.
      if (cursor.current === 0) {
        setError(err instanceof ApiError ? err.message : "Could not load the timeline.");
      }
    } finally {
      setLoading(false);
    }
  }, [runId]);

  // First read, and a fresh start whenever the run changes.
  useEffect(() => {
    cursor.current = 0;
    setEvents([]);
    setLoading(true);
    void load();
  }, [load]);

  // Tab visibility: back off while hidden, and read once the moment it returns
  // rather than waiting out the longer interval.
  useEffect(() => {
    const onVisibility = () => {
      const isHidden = document.hidden;
      setHidden(isHidden);
      if (!isHidden) void load();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [load]);

  // Polling. An interval rather than a chained timeout, for the reason
  // run-detail.tsx documents: one failed poll leaves state unchanged, so a
  // timeout would never be rescheduled and polling would silently die.
  useEffect(() => {
    const ms = pollIntervalMs(runStatus, hidden);
    if (ms == null) return;
    const id = setInterval(() => void load(), ms);
    return () => clearInterval(id);
  }, [runStatus, hidden, load]);

  // The elapsed clock on a running stage. Only while something is running.
  useEffect(() => {
    if (!shouldPoll(runStatus) || hidden) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [runStatus, hidden]);

  const groups = useMemo(() => groupEvents(events, runStatus), [events, runStatus]);

  // Default collapse state for groups the reader has not touched.
  useEffect(() => {
    setCollapsed((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const g of groups) {
        if (touched.current.has(g.key)) continue;
        const want = startsCollapsed(g);
        if (next[g.key] !== want) {
          next[g.key] = want;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [groups]);

  // Follow the feed unless the reader has scrolled away from the bottom.
  useEffect(() => {
    if (!pinned) return;
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events, collapsed, pinned]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < PIN_SLACK_PX);
  };

  const jumpToLatest = () => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    setPinned(true);
  };

  const toggle = (key: string) => {
    touched.current.add(key);
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  if (loading && events.length === 0) {
    return (
      <div style={wrapStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--c-ink-3)", fontSize: "var(--fs-sm)" }}>
          <Loader2 size={12} className="animate-spin" />
          Loading the timeline…
        </div>
      </div>
    );
  }

  if (error && events.length === 0) {
    return (
      <div style={wrapStyle}>
        <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-2)" }}>{error}</div>
        <button className="bm-ghost" style={{ marginTop: 8 }} onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div style={wrapStyle}>
        <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-3)" }}>
          {shouldPoll(runStatus)
            ? "Waiting for the first step…"
            : "No timeline was recorded for this run."}
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <div
        ref={scroller}
        onScroll={onScroll}
        tabIndex={0}
        role="log"
        aria-live="polite"
        aria-label="Run activity"
        style={{
          ...wrapStyle,
          maxHeight: 460,
          overflowY: "auto",
          padding: 0,
        }}
      >
        {groups.map((g) => (
          <TimelineGroupRow
            key={g.key}
            group={g}
            collapsed={collapsed[g.key] ?? false}
            onToggle={() => toggle(g.key)}
            now={now}
          />
        ))}
      </div>

      {!pinned && shouldPoll(runStatus) && (
        <button
          className="bm-ghost"
          onClick={jumpToLatest}
          style={{
            position: "absolute",
            right: 12,
            bottom: 12,
            background: "var(--c-surface)",
            boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
          }}
        >
          <ArrowDown size={12} />
          Jump to latest
        </button>
      )}
    </div>
  );
}

const wrapStyle: React.CSSProperties = {
  border: "1px solid var(--c-border)",
  borderRadius: 4,
  background: "var(--c-surface)",
  padding: 12,
};

function TimelineGroupRow({
  group,
  collapsed,
  onToggle,
  now,
}: {
  group: TimelineGroup;
  collapsed: boolean;
  onToggle: () => void;
  now: number;
}) {
  const running = group.endedAt === null;
  const elapsed = running ? elapsedMs(group.startedAt, now) : group.durationMs;
  const tone = group.state === "failed" || group.state === "warn" ? "attention" : group.state === "ok" ? "ok" : "muted";

  return (
    <div
      style={{
        borderBottom: "1px solid var(--c-border)",
        // The current group gets a quiet left marker rather than a fill, so a
        // long feed does not turn into a block of colour.
        borderLeft: group.current ? "2px solid var(--c-blue)" : "2px solid transparent",
        background: group.current ? "var(--c-blue-bg)" : "transparent",
      }}
    >
      <button
        onClick={onToggle}
        aria-expanded={!collapsed}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "7px 12px",
          background: "transparent",
          border: "none",
          textAlign: "left",
          cursor: "pointer",
          font: "inherit",
        }}
      >
        {collapsed ? (
          <ChevronRight size={12} style={{ color: "var(--c-ink-4)", flexShrink: 0 }} />
        ) : (
          <ChevronDown size={12} style={{ color: "var(--c-ink-4)", flexShrink: 0 }} />
        )}
        <span
          style={{
            fontSize: "var(--fs-xs)",
            fontWeight: 700,
            color: "var(--c-ink)",
            minWidth: 68,
            flexShrink: 0,
          }}
        >
          {agentLabel(group.agent)}
        </span>
        <span
          style={{
            fontSize: "var(--fs-sm)",
            color: TONE_COLOR[tone],
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {groupSummary(group)}
        </span>
        {running && <Loader2 size={11} className="animate-spin" style={{ color: "var(--c-ink-4)", flexShrink: 0 }} />}
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: "var(--fs-xs)",
            color: "var(--c-ink-4)",
            flexShrink: 0,
            minWidth: 48,
            textAlign: "right",
          }}
        >
          {formatDuration(elapsed) ?? ""}
        </span>
      </button>

      {!collapsed && (
        <div style={{ padding: "0 12px 8px 34px" }}>
          {group.events.map((e) => (
            <EventRow key={e.seq} event={e} />
          ))}
        </div>
      )}
    </div>
  );
}

function EventRow({ event }: { event: RunEvent }) {
  const tone = statusTone(event.status);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 8,
        padding: "2px 0",
        fontSize: "var(--fs-sm)",
        lineHeight: 1.5,
      }}
    >
      <span
        aria-hidden
        style={{
          fontFamily: "var(--mono)",
          fontSize: "var(--fs-xs)",
          color: TONE_COLOR[tone],
          width: 10,
          flexShrink: 0,
        }}
      >
        {statusGlyph(event.status)}
      </span>
      {/* The glyph is decorative; the status travels in words for a reader who
          cannot see colour or shape. */}
      <span className="sr-only">{event.status}</span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          color: tone === "attention" ? "var(--c-amber)" : "var(--c-ink-2)",
          fontFamily: isMonoType(event.type) ? "var(--mono)" : undefined,
          fontSize: isMonoType(event.type) ? "var(--fs-xs)" : "var(--fs-sm)",
          overflowWrap: "anywhere",
        }}
      >
        {event.summary}
      </span>
      <span
        style={{
          fontFamily: "var(--mono)",
          fontSize: "var(--fs-xs)",
          color: "var(--c-ink-4)",
          flexShrink: 0,
        }}
      >
        {formatClock(event.createdAt)}
      </span>
    </div>
  );
}
