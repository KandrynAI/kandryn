import Link from 'next/link';
import { STAGES, STAGES_HEADING, STAGES_LINK } from '@/lib/home';

/**
 * Section 4 — three stages, a sentence each.
 *
 * The old page put ten numbered steps here under a heading that said seven.
 * Orchestration detail, agent names and setup instructions all live on How It
 * Works now; this section's job is to make the shape of the loop legible in
 * about fifteen seconds and then get out of the way.
 */
export default function StagesSection() {
  return (
    <section
      className="pad-x"
      style={{ padding: '76px 64px', borderBottom: '2px solid var(--color-divider)' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 24,
          flexWrap: 'wrap',
        }}
      >
        <h2 style={{ fontSize: 38, fontWeight: 600, lineHeight: 1.15, letterSpacing: '-0.018em' }}>{STAGES_HEADING}</h2>
        <Link
          href={STAGES_LINK.href}
          style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-accent)' }}
        >
          {STAGES_LINK.label} →
        </Link>
      </div>

      <ol
        className="grid-3 stack-1"
        style={{
          marginTop: 32,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          borderTop: '2px solid var(--color-divider)',
          borderLeft: '2px solid var(--color-divider)',
        }}
      >
        {STAGES.map((s) => (
          <li
            key={s.n}
            style={{
              borderRight: '2px solid var(--color-divider)',
              borderBottom: '2px solid var(--color-divider)',
              padding: '26px 28px',
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.12em',
                color: 'var(--color-accent-700)',
              }}
            >
              {s.n}
            </div>
            <h3 style={{ marginTop: 12, fontSize: 21, fontWeight: 600, lineHeight: 1.25, letterSpacing: '-0.008em' }}>
              {s.title}
            </h3>
            <p
              style={{
                marginTop: 8,
                fontSize: 15,
                lineHeight: 1.6,
                color: 'var(--color-neutral-800)',
                textWrap: 'pretty',
              }}
            >
              {s.body}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
