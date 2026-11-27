/**
 * The illustrative artifacts.
 *
 * One per industry, deliberately. The brief's warning is the right one: six
 * pages built from one component with the noun swapped teach a reader
 * nothing, because the shape of the misunderstanding differs by industry. A
 * wait is a timeline. A queue is a routing decision. A refund is arithmetic.
 * A plan version is a date lookup. Each gets the form that carries it.
 *
 * All of them are semantic HTML with real text, so they are readable at
 * 320px, selectable, searchable and legible to a screen reader. None is an
 * image of a number.
 */

const CELL: React.CSSProperties = {
  padding: '12px 14px',
  fontSize: 14.5,
  borderTop: '1px solid var(--color-divider)',
  verticalAlign: 'top',
};
const HEAD: React.CSSProperties = {
  padding: '10px 14px',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--color-neutral-600)',
  textAlign: 'left',
};

function Pill({ children, tone = 'quiet' }: { children: React.ReactNode; tone?: 'quiet' | 'accent' }) {
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 12.5,
        fontWeight: 600,
        padding: '3px 9px',
        borderRadius: 999,
        background: tone === 'accent' ? 'var(--color-accent-100)' : 'var(--color-neutral-200)',
        color: tone === 'accent' ? 'var(--color-accent-700)' : 'var(--color-neutral-700)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

/** A: a dated case timeline, with the two events the measure uses marked. */
export function CaseTimeline({
  events,
  caption,
}: {
  events: { date: string; label: string; counts?: boolean }[];
  caption: string;
}) {
  return (
    <figure style={{ margin: 0 }}>
      <ol style={{ display: 'grid', gap: 0 }}>
        {events.map((e, i) => (
          <li
            key={e.label}
            style={{
              display: 'grid',
              gridTemplateColumns: '92px 20px minmax(0, 1fr)',
              alignItems: 'start',
              gap: 14,
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)', paddingTop: 10 }}>{e.date}</span>
            <span style={{ position: 'relative', height: '100%', minHeight: 46 }} aria-hidden="true">
              <span
                style={{
                  position: 'absolute', left: 5, top: 14, width: 11, height: 11, borderRadius: 999,
                  background: e.counts ? 'var(--color-accent)' : 'var(--color-bg)',
                  border: `2px solid ${e.counts ? 'var(--color-accent)' : 'var(--color-neutral-400)'}`,
                }}
              />
              {i < events.length - 1 && (
                <span style={{ position: 'absolute', left: 10, top: 26, bottom: -6, width: 2, background: 'var(--color-divider)' }} />
              )}
            </span>
            <span style={{ paddingTop: 9, paddingBottom: 14, fontSize: 15, lineHeight: 1.45 }}>
              {e.label}{' '}
              {e.counts && <Pill tone="accent">counts</Pill>}
            </span>
          </li>
        ))}
      </ol>
      <figcaption className="body-2" style={{ marginTop: 6 }}>{caption}</figcaption>
    </figure>
  );
}

/** B: a records table. Status, owner, and whose turn it is. */
export function RecordsTable({
  columns,
  rows,
  caption,
}: {
  columns: string[];
  rows: { cells: string[]; highlight?: boolean }[];
  caption: string;
}) {
  return (
    <figure style={{ margin: 0 }}>
      <div className="scroll-x" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 460, borderCollapse: 'collapse' }}>
          <thead>
            <tr>{columns.map((c) => <th key={c} style={HEAD} scope="col">{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cells[0]} style={r.highlight ? { background: 'var(--color-accent-100)' } : undefined}>
                {r.cells.map((cell, i) => (
                  <td key={i} style={{ ...CELL, fontWeight: i === 0 ? 650 : 400 }}>
                    {i === r.cells.length - 1 ? <Pill tone={r.highlight ? 'accent' : 'quiet'}>{cell}</Pill> : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <figcaption className="body-2" style={{ marginTop: 12 }}>{caption}</figcaption>
    </figure>
  );
}

/** C: receipt arithmetic. The numbers are the point, so they line up. */
export function ReceiptCalc({
  lines,
  total,
  caption,
}: {
  lines: { label: string; value: string }[];
  total: { label: string; value: string };
  caption: string;
}) {
  return (
    <figure style={{ margin: 0, maxWidth: 420 }}>
      <dl style={{ margin: 0 }}>
        {lines.map((l) => (
          <div
            key={l.label}
            style={{ display: 'flex', justifyContent: 'space-between', gap: 20, padding: '11px 0', borderBottom: '1px solid var(--color-divider)' }}
          >
            <dt style={{ fontSize: 15 }}>{l.label}</dt>
            <dd style={{ margin: 0, fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{l.value}</dd>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, padding: '14px 0 0' }}>
          <dt style={{ fontSize: 16, fontWeight: 700 }}>{total.label}</dt>
          <dd
            style={{ margin: 0, fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-accent-700)' }}
          >
            {total.value}
          </dd>
        </div>
      </dl>
      <figcaption className="body-2" style={{ marginTop: 14 }}>{caption}</figcaption>
    </figure>
  );
}

/** E: the review clock. Elapsed time as segments, only some of which count. */
export function ReviewClock({
  segments,
  caption,
}: {
  segments: { days: number; label: string; counts: boolean }[];
  caption: string;
}) {
  const total = segments.reduce((n, s) => n + s.days, 0);
  const counted = segments.filter((s) => s.counts).reduce((n, s) => n + s.days, 0);
  return (
    <figure style={{ margin: 0 }}>
      <div style={{ display: 'flex', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--color-divider)' }}>
        {segments.map((s, i) => (
          <div
            key={i}
            style={{
              flex: s.days,
              padding: '14px 12px',
              background: s.counts ? 'var(--color-accent-200)' : 'var(--color-neutral-200)',
              borderLeft: i === 0 ? undefined : '1px solid var(--color-divider)',
              minWidth: 0,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: s.counts ? 'var(--color-accent-800)' : 'var(--color-neutral-700)' }}>
              {s.days} {s.days === 1 ? 'day' : 'days'}
            </div>
            <div style={{ fontSize: 12.5, marginTop: 3, color: 'var(--color-neutral-700)', lineHeight: 1.35 }}>{s.label}</div>
          </div>
        ))}
      </div>
      <p style={{ marginTop: 14, fontSize: 15 }}>
        <strong style={{ fontWeight: 700 }}>{counted} review days</strong> across {total} elapsed days.
      </p>
      <figcaption className="body-2" style={{ marginTop: 6 }}>{caption}</figcaption>
    </figure>
  );
}


/** F: two dates, and which plan version the lookup lands on. */
export function PlanVersionPick({
  dates,
  versions,
  caption,
}: {
  dates: { label: string; value: string; drives?: boolean }[];
  versions: { label: string; range: string; selected?: boolean }[];
  caption: string;
}) {
  return (
    <figure style={{ margin: 0 }}>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {dates.map((d) => (
          <div
            key={d.label}
            style={{
              flex: '1 1 190px',
              padding: '14px 16px',
              borderRadius: 'var(--radius-md)',
              border: `1px solid ${d.drives ? 'var(--color-accent-400)' : 'var(--color-divider)'}`,
              background: d.drives ? 'var(--color-accent-100)' : 'var(--color-bg)',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-neutral-600)' }}>
              {d.label}
            </div>
            <div style={{ fontSize: 19, fontWeight: 700, marginTop: 5 }}>{d.value}</div>
            {d.drives && <div style={{ marginTop: 8 }}><Pill tone="accent">drives the lookup</Pill></div>}
          </div>
        ))}
      </div>
      <ul style={{ marginTop: 18, display: 'grid', gap: 8 }}>
        {versions.map((v) => (
          <li
            key={v.label}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
              padding: '12px 14px',
              borderRadius: 'var(--radius-md)',
              border: `1px solid ${v.selected ? 'var(--color-accent-400)' : 'var(--color-divider)'}`,
              background: v.selected ? 'var(--color-accent-100)' : 'var(--color-bg)',
            }}
          >
            <span style={{ fontSize: 15, fontWeight: v.selected ? 700 : 500 }}>{v.label}</span>
            <span style={{ fontSize: 14, color: 'var(--color-neutral-700)' }}>{v.range}</span>
            {v.selected && <Pill tone="accent">shown to the reviewer</Pill>}
          </li>
        ))}
      </ul>
      <figcaption className="body-2" style={{ marginTop: 14 }}>{caption}</figcaption>
    </figure>
  );
}
