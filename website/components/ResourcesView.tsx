import { QUICKSTART, CHANGELOG } from '@/lib/site';

/**
 * Resources — deliberately two sections.
 *
 * This page used to carry a featured guide, twelve resource cards across four
 * filter tabs, and a monthly newsletter. None of the thirteen pieces of
 * writing existed: the cards rendered "Read →" as plain text with no link
 * behind them, and each carried a specific reading time. Fabricated specifics
 * about content that does not exist is a worse problem than a thin page, so
 * the page is now the two things that are real — the setup sequence and what
 * actually shipped.
 *
 * Guides can come back here when they are written. Cards first, writing later,
 * is how the previous version happened.
 */
export default function ResourcesView() {
  return (
    <>
      {/* Quickstart — the real one, matching what Settings actually asks for */}
      <section
        className="pad-x"
        style={{ padding: '56px 64px', borderTop: '2px solid var(--color-divider)', borderBottom: '2px solid var(--color-divider)' }}
      >
        <h2 style={{ fontSize: 34, fontWeight: 600, lineHeight: 1.15, letterSpacing: '-0.018em' }}>From nothing to a pull request</h2>
        <p
          style={{
            marginTop: 12,
            maxWidth: 620,
            fontSize: 17,
            lineHeight: 1.6,
            color: 'var(--color-neutral-800)',
            textWrap: 'pretty',
          }}
        >
          Six steps, about fifteen minutes of setup, and one real work item. The times are how long each step takes,
          not how long a run takes.
        </p>

        <ol style={{ marginTop: 32, display: 'flex', flexDirection: 'column', borderTop: '2px solid var(--color-divider)' }}>
          {QUICKSTART.map((q) => (
            <li
              key={q.n}
              className="quickstep"
              style={{
                display: 'grid',
                gridTemplateColumns: '48px 1fr auto',
                gap: 20,
                alignItems: 'baseline',
                borderBottom: '1px solid var(--color-neutral-300)',
                padding: '18px 0',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  color: 'var(--color-accent-700)',
                }}
              >
                {q.n}
              </span>
              <div>
                <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.25, letterSpacing: '-0.008em' }}>{q.title}</div>
                <div
                  style={{
                    fontSize: 15,
                    lineHeight: 1.6,
                    color: 'var(--color-neutral-800)',
                    marginTop: 4,
                    textWrap: 'pretty',
                  }}
                >
                  {q.body}
                </div>
              </div>
              <span style={{ fontSize: 13, color: 'var(--color-neutral-600)', whiteSpace: 'nowrap' }}>{q.time}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* Changelog — what actually shipped, dated */}
      <section className="pad-x" style={{ padding: '56px 64px', borderBottom: '2px solid var(--color-divider)' }}>
        <h2 style={{ fontSize: 34, fontWeight: 600, lineHeight: 1.15, letterSpacing: '-0.018em' }}>What shipped</h2>
        <div style={{ marginTop: 28, borderTop: '2px solid var(--color-divider)' }}>
          {CHANGELOG.map((c) => (
            <div
              key={c.date}
              className="changerow"
              style={{
                display: 'grid',
                gridTemplateColumns: '130px 1fr',
                gap: 20,
                borderBottom: '1px solid var(--color-neutral-300)',
                padding: '18px 0',
              }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--color-neutral-600)' }}>
                {c.date}
              </span>
              <div>
                <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>{c.title}</div>
                <div
                  style={{
                    fontSize: 15,
                    lineHeight: 1.6,
                    color: 'var(--color-neutral-800)',
                    marginTop: 4,
                    textWrap: 'pretty',
                  }}
                >
                  {c.body}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
