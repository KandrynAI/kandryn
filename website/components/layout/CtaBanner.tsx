import Link from 'next/link';

export default function CtaBanner() {
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
        style={{
          marginTop: 20,
          fontSize: 62,
          fontWeight: 900,
          letterSpacing: '-0.035em',
          lineHeight: 0.96,
          maxWidth: 1000,
        }}
      >
        Queue the work tonight.
        <br />
        Read the pull requests
        <br />
        in the morning.
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
