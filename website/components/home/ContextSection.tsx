import Link from 'next/link';
import { CONTEXT } from '@/lib/home';
import { CellGrid, Cell } from '@/components/ui/Section';

/**
 * Section 2. How business context speeds up delivery.
 *
 * It sits directly under the hero because it is the hero's own claim, spelled
 * out: identify the context, build it into the change, keep it current. Each
 * point traces to a row in docs/marketing-claims.md, and the third is the one
 * that needed the most care, because the repository refresh is queued and
 * swept rather than immediate.
 *
 * No new layout: the section shell matches its siblings and the points use the
 * shared CellGrid/Cell primitives that /integrations already renders.
 */
export default function ContextSection() {
  return (
    <section
      className="pad-x"
      style={{ padding: '76px 64px', borderBottom: '2px solid var(--color-divider)' }}
    >
      <h2 style={{ fontSize: 38, fontWeight: 600, lineHeight: 1.15, letterSpacing: '-0.018em' }}>
        {CONTEXT.heading}
      </h2>
      <p
        style={{
          marginTop: 12,
          maxWidth: 640,
          fontSize: 17,
          lineHeight: 1.6,
          color: 'var(--color-neutral-800)',
          textWrap: 'pretty',
        }}
      >
        {CONTEXT.lead}
      </p>

      <CellGrid cols={3} style={{ marginTop: 36 }}>
        {CONTEXT.points.map((p) => (
          <Cell key={p.title} title={p.title}>
            {p.body}
          </Cell>
        ))}
      </CellGrid>

      <p className="meta" style={{ marginTop: 20, maxWidth: 640 }}>
        {CONTEXT.closing}
      </p>

      <p style={{ marginTop: 18 }}>
        <Link
          href={CONTEXT.link.href}
          style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-accent-700)' }}
        >
          {CONTEXT.link.label} &rarr;
        </Link>
      </p>
    </section>
  );
}
