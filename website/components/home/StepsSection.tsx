import { STEPS } from '@/lib/site';

export default function StepsSection() {
  return (
    <section className="pad-x" style={{ borderTop: '2px solid var(--color-divider)', padding: '56px 64px' }}>
      <h2 style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 6 }}>
        Seven steps, one thread
      </h2>
      <p style={{ fontSize: 16, color: 'var(--color-neutral-800)', maxWidth: 720, marginBottom: 32 }}>
        From the credential you paste on day one to the test case that lands back in Jira, every step
        is scoped to your account and your repository.
      </p>
      <div
        className="grid-4 stack-1"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          borderTop: '2px solid var(--color-divider)',
          borderLeft: '2px solid var(--color-divider)',
        }}
      >
        {STEPS.map((s) => (
          <div
            key={s.n}
            style={{
              borderRight: '2px solid var(--color-divider)',
              borderBottom: '2px solid var(--color-divider)',
              padding: 24,
              minHeight: 168,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.12em', color: 'var(--color-accent-700)' }}>
              {s.n}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, marginTop: 12 }}>{s.title}</div>
            <div style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--color-neutral-700)', marginTop: 8, textWrap: 'pretty' }}>
              {s.body}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
