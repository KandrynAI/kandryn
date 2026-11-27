import type { ReactNode } from 'react';
import PageIndex, { type IndexItem } from '@/components/legal/PageIndex';

/* Legal-document tokens.
 *
 * These were four hardcoded hexes from an earlier design, including a blue
 * accent that no longer exists anywhere else on the site, so Privacy and
 * Terms read as pages from a different product. They point at the site
 * tokens now, which is a colour change and nothing else: not one word of
 * either document is touched here. */
const INK = 'var(--color-text)';
const BODY = 'var(--color-neutral-800)';
const BORDER = 'var(--color-divider)';
const ACCENT = 'var(--color-accent)';
// Was a hardcoded copy of --color-neutral-600's old value, which failed AA on
// white at 4.01:1. Tracks the token now so it cannot drift again.
const MUTED = 'var(--color-neutral-600)';

/**
 * The reading column, with its contents beside it.
 *
 * A legal page is read with one question in hand, so the contents belong
 * where they stay in view. `index` renders the sticky desktop rail and the
 * collapsed mobile index that Trust uses, from the same anchors the boxed
 * table of contents used, so every existing deep link still resolves.
 */
export function LegalPage({ children, index }: { children: ReactNode; index?: IndexItem[] }) {
  if (!index) return <article className="legal-page">{children}</article>;
  return (
    <div className="container doc-layout legal-shell">
      <PageIndex items={index} title="Contents" />
      <article className="legal-page">{children}</article>
    </div>
  );
}

export function LegalHeader({ title, sub, meta }: { title: string; sub: string; meta: ReactNode }) {
  return (
    <header>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: ACCENT }}>
        Legal
      </div>
      <h1
        style={{
          fontFamily: 'var(--font-archivo), Archivo, system-ui, sans-serif',
          fontWeight: 700,
          fontSize: 48,
          letterSpacing: '-0.02em',
          lineHeight: 1.04,
          color: INK,
          margin: '16px 0 0',
        }}
      >
        {title}
      </h1>
      <p style={{ fontSize: 18, lineHeight: 1.6, color: BODY, marginTop: 18, textWrap: 'pretty' }}>{sub}</p>
      <p style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 12, lineHeight: 1.7, color: MUTED, marginTop: 18 }}>
        {meta}
      </p>
    </header>
  );
}

export function Section({ id, n, title, children }: { id: string; n: number; title: string; children: ReactNode }) {
  return (
    <section id={id} style={{ scrollMarginTop: 88 }}>
      <h2
        style={{
          fontFamily: 'var(--font-archivo), Archivo, system-ui, sans-serif',
          fontWeight: 700,
          fontSize: 20,
          color: INK,
          marginTop: 48,
          paddingBottom: 8,
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        {n}. {title}
      </h2>
      {children}
    </section>
  );
}

export function H3({ children }: { children: ReactNode }) {
  return <h3 style={{ fontWeight: 600, fontSize: 15, color: INK, marginTop: 28 }}>{children}</h3>;
}

export function P({ children }: { children: ReactNode }) {
  return <p style={{ fontSize: 15, lineHeight: 1.75, color: BODY, marginTop: 14 }}>{children}</p>;
}

/** Em-dash bullets (no HTML markers), per Step 4. */
export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul style={{ listStyle: 'none', paddingLeft: 16, lineHeight: 1.8, margin: '12px 0 0' }}>
      {items.map((it, i) => (
        <li key={i} style={{ fontSize: 15, color: BODY }}>
          <span style={{ color: ACCENT, marginRight: 8 }}>—</span>
          {it}
        </li>
      ))}
    </ul>
  );
}

/** ALL-CAPS legal box (disclaimer / limitation of liability). */
export function DisclaimerBox({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 13,
        lineHeight: 1.6,
        color: '#4a5568',
        background: '#f4f6f9',
        padding: '16px 20px',
        borderLeft: '3px solid #8a9ab0',
        borderRadius: 4,
        marginTop: 16,
      }}
    >
      {children}
    </div>
  );
}

/** Blue-left-border contact block. */
export function ContactBlock({ children }: { children: ReactNode }) {
  return (
    <div style={{ borderLeft: `3px solid ${ACCENT}`, background: '#f0f4ff', padding: '16px 20px', marginTop: 24 }}>
      {children}
    </div>
  );
}

export function Mail({ addr }: { addr: string }) {
  return (
    <a href={`mailto:${addr}`} style={{ color: ACCENT, fontWeight: 600, textDecoration: 'none' }}>
      {addr}
    </a>
  );
}
