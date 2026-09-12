'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Shared closing call to action, appended to every page by the layout.
 *
 * The homepage is the exception: it ends with its own ClosingCta, and stacking
 * two competing offers gives a visitor at the bottom of the page a way to
 * defer the decision rather than make it.
 */
export default function CtaBanner() {
  const pathname = usePathname() || '/';
  if (pathname === '/') return null;

  return (
    <section
      className="pad-x"
      style={{
        background: 'var(--color-accent)',
        color: '#ffffff',
        padding: '84px 64px',
      }}
    >
      <div className="kicker" style={{ color: '#ffffff', opacity: 0.85 }}>
        Request access
      </div>
      <h2
        className="cta-h2"
        style={{
          marginTop: 20,
          fontSize: 62,
          fontWeight: 700,
          letterSpacing: '-0.022em',
          lineHeight: 1.02,
          maxWidth: 1000,
        }}
      >
        Queue the work tonight. Read the pull requests in the morning.
      </h2>
      <div style={{ display: 'flex', gap: 14, marginTop: 40, flexWrap: 'wrap' }}>
        <Link
          href="/contact"
          className="btn"
          style={{
            fontSize: 15,
            fontWeight: 700,
            padding: '14px 22px',
            border: '2px solid #ffffff',
            background: '#ffffff',
            color: 'var(--color-accent-700)',
          }}
        >
          Request access
        </Link>
        <Link
          href="/resources"
          className="btn"
          style={{
            fontSize: 15,
            fontWeight: 700,
            padding: '14px 22px',
            border: '2px solid #ffffff',
            background: 'transparent',
            color: '#ffffff',
          }}
        >
          Read the guides
        </Link>
      </div>
    </section>
  );
}
