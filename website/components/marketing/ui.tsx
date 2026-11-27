import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * The shared marketing page primitives.
 *
 * Industry pages, use cases, lessons and reference pages are all built from
 * these, so the six industry pages cannot drift into six layouts. The
 * CONTENT of each page lives in its own data file and stays individually
 * editable; only the furniture is shared.
 */

export function PageHero({
  eyebrow,
  h1,
  lead,
  children,
}: {
  eyebrow?: string;
  h1: string;
  lead?: string;
  children?: ReactNode;
}) {
  return (
    <header className="sec" style={{ background: 'var(--color-bg)', borderBottom: '1px solid var(--color-divider)' }}>
      <div className="container">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1
          style={{
            fontSize: 'clamp(32px, 4.2vw, 52px)',
            fontWeight: 700,
            lineHeight: 1.08,
            letterSpacing: '-0.025em',
            maxWidth: '18ch',
          }}
        >
          {h1}
        </h1>
        {lead && <p className="lead-2" style={{ marginTop: 20 }}>{lead}</p>}
        {children}
      </div>
    </header>
  );
}

export function Section({
  eyebrow,
  h2,
  lead,
  quiet,
  children,
}: {
  eyebrow?: string;
  h2?: string;
  lead?: string;
  quiet?: boolean;
  children?: ReactNode;
}) {
  return (
    <section className="sec" style={quiet ? { background: 'var(--color-surface)' } : undefined}>
      <div className="container">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        {h2 && <h2 className="h2">{h2}</h2>}
        {lead && <p className="lead-2">{lead}</p>}
        {children}
      </div>
    </section>
  );
}

/** The label every invented scenario on this site carries. */
export function IllustrativeTag() {
  return <div className="illus-note">Illustrative example</div>;
}

/**
 * A worked example: the request, the rule that changes it, and the result.
 *
 * `visual` is where each page differs. Every industry page passes its own,
 * because six pages with one swapped noun is the failure mode the brief
 * names outright.
 */
export function WorkedExample({
  heading,
  rows,
  result,
  visual,
  children,
}: {
  heading: string;
  rows: [string, string][];
  result?: string;
  visual?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="panel panel-pad" style={{ marginTop: 28 }}>
      <IllustrativeTag />
      <h3 className="h3" style={{ marginTop: 10 }}>{heading}</h3>
      <dl className="kv" style={{ marginTop: 20 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {visual && <div style={{ marginTop: 24 }}>{visual}</div>}
      {result && (
        <p
          style={{
            marginTop: 22,
            paddingTop: 18,
            borderTop: '1px solid var(--color-divider)',
            fontSize: 18,
            fontWeight: 650,
            letterSpacing: '-0.01em',
            color: 'var(--color-accent-700)',
          }}
        >
          {result}
        </p>
      )}
      {children}
    </div>
  );
}

/** The two readings of one change, side by side. */
export function ReviewPair({ business, engineering }: { business: string; engineering: string }) {
  return (
    <div className="cols-2" style={{ marginTop: 28 }}>
      {[
        ['Business review', business],
        ['Engineering review', engineering],
      ].map(([title, body]) => (
        <div key={title} className="panel-quiet panel-pad">
          <h3 className="h3">{title}</h3>
          <p className="body-2" style={{ marginTop: 10 }}>{body}</p>
        </div>
      ))}
    </div>
  );
}

export function LinkGrid({
  items,
  columns = 3,
}: {
  items: { label: string; href: string; blurb?: string }[];
  columns?: 2 | 3;
}) {
  return (
    <div className={columns === 2 ? 'cols-2' : 'cols-3'} style={{ marginTop: 32 }}>
      {items.map((item) => (
        <Link key={item.href} href={item.href} className="card-link">
          <span className="h3" style={{ display: 'block' }}>{item.label}</span>
          {item.blurb && <span className="body-2" style={{ display: 'block', marginTop: 8 }}>{item.blurb}</span>}
          <span className="arrowlink" style={{ display: 'block', marginTop: 14 }}>Read more &rarr;</span>
        </Link>
      ))}
    </div>
  );
}

export function LinkRow({ links }: { links: { label: string; href: string }[] }) {
  return (
    <div className="linkrow">
      {links.map((l) => (
        <Link key={l.href + l.label} href={l.href} className="arrowlink">
          {l.label} &rarr;
        </Link>
      ))}
    </div>
  );
}

/** The closing invitation. Same shape on every page that ends with one. */
export function CtaBlock({
  h2,
  body,
  primary = { label: 'Request a walkthrough', href: '/contact' },
  secondary,
}: {
  h2: string;
  body?: string;
  primary?: { label: string; href: string };
  secondary?: { label: string; href: string };
}) {
  return (
    <section className="sec" style={{ background: 'var(--color-action)', color: '#ffffff' }}>
      <div className="container">
        <h2
          style={{
            fontSize: 'clamp(26px, 3vw, 38px)',
            fontWeight: 650,
            lineHeight: 1.16,
            letterSpacing: '-0.02em',
            maxWidth: '24ch',
          }}
        >
          {h2}
        </h2>
        {body && (
          <p style={{ marginTop: 16, maxWidth: '58ch', fontSize: 17, lineHeight: 1.6, color: 'rgba(255,255,255,0.86)' }}>
            {body}
          </p>
        )}
        <div style={{ marginTop: 30, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <Link
            className="btn"
            href={primary.href}
            style={{ background: '#ffffff', color: 'var(--color-action)', border: '1px solid #ffffff' }}
          >
            {primary.label}
          </Link>
          {secondary && (
            <Link
              className="btn"
              href={secondary.href}
              style={{ background: 'transparent', color: '#ffffff', border: '1px solid rgba(255,255,255,0.5)' }}
            >
              {secondary.label}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
