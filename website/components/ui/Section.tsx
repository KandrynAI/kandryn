import type { CSSProperties, ReactNode } from 'react';

/**
 * Layout primitives.
 *
 * Every page was re-declaring the same section padding, heading size and
 * bordered-grid arithmetic inline — Trust carried ninety-two style objects and
 * three body sizes doing one job. These wrap the classes in globals.css so a
 * page says what a block *is* rather than how to draw it.
 *
 * They emit the existing .grid-N / .stack-1 / .pad-x classes, so the
 * responsive behaviour the finished pages already rely on is inherited rather
 * than reimplemented.
 */

interface SectionProps {
  children: ReactNode;
  /** Drop the bottom rule — for the last section above the footer band. */
  bare?: boolean;
  /** Remove bottom padding where the child supplies its own. */
  flush?: boolean;
  id?: string;
  style?: CSSProperties;
}

export function Section({ children, bare, flush, id, style }: SectionProps) {
  return (
    <section
      id={id}
      className={`sec pad-x${bare ? ' sec-bare' : ''}${flush ? ' sec-flush' : ''}`}
      style={style}
    >
      {children}
    </section>
  );
}

/**
 * The tinted banner that re-frames what follows it. How It Works uses it to
 * separate what runs automatically from what waits for a click; Integrations
 * to separate trackers from repositories.
 */
export function Band({
  title,
  note,
  accent,
  id,
}: {
  title: string;
  note?: string;
  accent?: boolean;
  id?: string;
}) {
  return (
    <div id={id} className={`band pad-x${accent ? ' band-accent' : ''}`}>
      <h2 className="h-2">{title}</h2>
      {note && <p className="lead">{note}</p>}
    </div>
  );
}

/** A section's heading, optionally with the one-paragraph lead beneath it. */
export function SectionHead({
  title,
  lead,
  display,
}: {
  title: ReactNode;
  lead?: ReactNode;
  /** The larger of the two heading tiers, for a section that opens a topic. */
  display?: boolean;
}) {
  return (
    <>
      <h2 className={display ? 'h-display' : 'h-2'}>{title}</h2>
      {lead && <p className="lead">{lead}</p>}
    </>
  );
}

/**
 * Bordered cell grid. The container draws its top and left rule and each cell
 * draws right and bottom, so interior rules never double up and a row that
 * wraps still closes its box.
 */
export function CellGrid({
  cols,
  children,
  style,
}: {
  cols: 2 | 3 | 4;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div className={`cellgrid grid-${cols} stack-1`} style={style}>
      {children}
    </div>
  );
}

/** One cell: a title, body copy, and an optional footnote under a hairline. */
export function Cell({
  title,
  tag,
  children,
  foot,
}: {
  title?: ReactNode;
  tag?: ReactNode;
  children?: ReactNode;
  foot?: ReactNode;
}) {
  return (
    <div>
      {(title || tag) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {title && <span className="h-4">{title}</span>}
          {tag}
        </div>
      )}
      {children && <div className="prose" style={{ marginTop: title || tag ? 8 : 0 }}>{children}</div>}
      {foot && (
        <div className="meta" style={{ marginTop: 12, borderTop: 'var(--hairline)', paddingTop: 10 }}>
          {foot}
        </div>
      )}
    </div>
  );
}
