import Link from 'next/link';
import { GOVERNANCE } from '@/lib/home';

/**
 * Section 5 — a pointer, deliberately small.
 *
 * The temptation on a governance-positioned product is to put the whole
 * compliance story on the homepage. That buries the product and duplicates
 * content that has to stay accurate in two places at once. Trust and Security
 * carry the verified detail — the enforcement mechanics, the sub-processor
 * list, the model disclosure, the audit retention — and this is one paragraph
 * and one link pointing at them.
 *
 * If this ever grows past three sentences, the extra belongs on the linked
 * page instead.
 */
export default function GovernanceCallout() {
  return (
    <section
      className="pad-x"
      style={{
        padding: '52px 64px',
        background: 'var(--color-neutral-100)',
        borderBottom: '2px solid var(--color-divider)',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 40,
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          borderLeft: '3px solid var(--color-accent)',
          paddingLeft: 24,
        }}
      >
        <div style={{ maxWidth: 720 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.01em' }}>
            {GOVERNANCE.heading}
          </h2>
          <p
            style={{
              marginTop: 8,
              fontSize: 16,
              lineHeight: 1.55,
              color: 'var(--color-neutral-800)',
              textWrap: 'pretty',
            }}
          >
            {GOVERNANCE.body}
          </p>
        </div>
        <Link
          href={GOVERNANCE.link.href}
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: 'var(--color-accent)',
            whiteSpace: 'nowrap',
            paddingTop: 4,
          }}
        >
          {GOVERNANCE.link.label} →
        </Link>
      </div>
    </section>
  );
}
