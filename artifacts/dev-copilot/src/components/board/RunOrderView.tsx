import type { RunOrderItem } from "@/services/api";

/**
 * Open work grouped into execution waves.
 *
 * Wave 1 can all start now; wave 2 waits on wave 1. Items caught in a
 * dependency cycle get their own group rather than a wave number, because no
 * order satisfies them — that is a tracker problem to fix, not an ordering to
 * follow.
 */
export function RunOrderView({
  items,
  cycleCount,
  onOpen,
}: {
  items: RunOrderItem[];
  cycleCount: number;
  onOpen: (itemId: number) => void;
}) {
  const waves = [...new Set(items.map((i) => i.wave).filter((w): w is number => w !== null))].sort(
    (a, b) => a - b,
  );
  const cyclic = items.filter((i) => i.wave === null);

  if (items.length === 0) {
    return (
      <p style={{ padding: 16, fontSize: "var(--fs-sm)", color: "var(--c-ink-3)" }}>
        Nothing open in this project.
      </p>
    );
  }

  return (
    <div style={{ padding: 16, overflowY: "auto", flex: 1 }}>
      {waves.map((w) => (
        <section key={w} style={{ marginBottom: 18 }}>
          <h3 style={headingStyle}>
            Wave {w}
            <span style={{ color: "var(--c-ink-4)", fontWeight: 400 }}>
              {w === 1 ? " · can start now" : ` · waits on wave ${w - 1}`}
            </span>
          </h3>
          <ul style={listStyle}>
            {items.filter((i) => i.wave === w).map((i) => (
              <Row key={i.itemId} item={i} onOpen={onOpen} />
            ))}
          </ul>
        </section>
      ))}

      {cyclic.length > 0 ? (
        <section>
          <h3 style={headingStyle}>
            Cycle
            <span style={{ color: "var(--c-ink-4)", fontWeight: 400 }}>
              {" "}
              · {cycleCount} item{cycleCount === 1 ? "" : "s"} block each other, so no order works
            </span>
          </h3>
          <ul style={listStyle}>
            {cyclic.map((i) => (
              <Row key={i.itemId} item={i} onOpen={onOpen} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Row({ item, onOpen }: { item: RunOrderItem; onOpen: (id: number) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(item.itemId)}
        style={{
          display: "flex",
          gap: 8,
          alignItems: "baseline",
          width: "100%",
          textAlign: "left",
          background: "none",
          border: 0,
          borderBottom: "1px solid var(--c-hairline)",
          padding: "6px 2px",
          cursor: "pointer",
        }}
      >
        <span style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-xs)", color: "var(--c-ink-4)", minWidth: 72 }}>
          {item.itemKey}
        </span>
        <span style={{ fontSize: "var(--fs-sm)", flex: 1 }}>{item.title}</span>
        {item.waitsOn.length > 0 ? (
          <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>
            waits on {item.waitsOn.join(", ")}
          </span>
        ) : null}
      </button>
    </li>
  );
}

const headingStyle: React.CSSProperties = {
  fontSize: "var(--fs-sm)",
  fontWeight: 600,
  marginBottom: 6,
};
const listStyle: React.CSSProperties = { listStyle: "none", margin: 0, padding: 0 };
