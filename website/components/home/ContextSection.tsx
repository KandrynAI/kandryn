import { CONTEXT } from '@/lib/home';
import { CellGrid, Cell } from '@/components/ui/Section';

/**
 * Section 4. What Kandryn knows before it writes.
 *
 * The homepage could say what a run produces but not what it reads, which left
 * the obvious buyer question ("does it know anything about our project?")
 * answered nowhere on the site. Every point here traces to a row in
 * docs/marketing-claims.md.
 *
 * No new layout: the section shell matches its siblings (UseCases,
 * StagesSection) and the four points use the shared CellGrid/Cell primitives
 * that /integrations already renders.
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

      <CellGrid cols={4} style={{ marginTop: 36 }}>
        {CONTEXT.points.map((p) => (
          <Cell key={p.title} title={p.title}>
            {p.body}
          </Cell>
        ))}
      </CellGrid>

      <p className="meta" style={{ marginTop: 20, maxWidth: 640 }}>
        {CONTEXT.closing}
      </p>
    </section>
  );
}
