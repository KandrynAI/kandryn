import type { Metadata } from 'next';
import PageHeader from '@/components/layout/PageHeader';
import Btn from '@/components/ui/Btn';
import { CONNECTORS, MODEL_KEYS, CAPABILITY_MATRIX, CAPABILITY_FOOTNOTE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Integrations',
  description:
    'What you connect, what each credential can reach, and which capabilities each provider supports.',
};

/**
 * Integrations.
 *
 * The page now answers the question it is named for — what do I have to plug
 * in? — in the order someone does it: a tracker, a repository, the model keys
 * the agents run on, and optionally somewhere to publish runbooks. The six
 * agents used to sit here as peer cards beside Jira and GitHub, which buried
 * the connectors and duplicated /how-it-works.
 */
export default function IntegrationsPage() {
  const groups = [...new Set(CONNECTORS.map((c) => c.kind))];

  return (
    <>
      <PageHeader
        title={<>Your tracker.<br />Your repository. Your keys.</>}
        lead="Kandryn stores every credential against your user record, tests it before it is saved, and tells you plainly what each one can reach."
      />

      {groups.map((group) => (
        <section key={group} style={{ borderBottom: '2px solid var(--color-divider)' }}>
          <div
            className="pad-x"
            style={{
              padding: '28px 64px 22px',
              background: 'var(--color-neutral-100)',
              borderBottom: '2px solid var(--color-divider)',
            }}
          >
            <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.015em' }}>{group}</h2>
          </div>

          <div
            className="grid-2 stack-1"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}
          >
            {CONNECTORS.filter((c) => c.kind === group).map((c, i, arr) => (
              <div
                key={c.name}
                style={{
                  borderRight: i < arr.length - 1 ? '2px solid var(--color-divider)' : 'none',
                  padding: '30px 40px',
                }}
              >
                <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em' }}>{c.name}</div>
                <p
                  style={{
                    fontSize: 15,
                    lineHeight: 1.5,
                    color: 'var(--color-neutral-800)',
                    marginTop: 10,
                    textWrap: 'pretty',
                  }}
                >
                  {c.body}
                </p>
                <div
                  className="scroll-x"
                  style={{
                    marginTop: 16,
                    borderTop: '1px solid var(--color-neutral-300)',
                    paddingTop: 12,
                    fontSize: 12,
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--color-neutral-700)',
                    overflowX: 'auto',
                  }}
                >
                  {c.creds}
                </div>
                <div style={{ fontSize: 13, color: 'var(--color-neutral-700)', marginTop: 8, textWrap: 'pretty' }}>
                  {c.note}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {/* The keys. Stated once, plainly — this is the setup step people get
          wrong, and the one the old page actively misled about. */}
      <section
        className="pad-x"
        style={{ padding: '56px 64px', borderBottom: '2px solid var(--color-divider)' }}
      >
        <h2 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em' }}>{MODEL_KEYS.heading}</h2>
        <p
          style={{
            marginTop: 12,
            maxWidth: 680,
            fontSize: 17,
            lineHeight: 1.5,
            color: 'var(--color-neutral-800)',
            textWrap: 'pretty',
          }}
        >
          {MODEL_KEYS.body}
        </p>
        <ul
          className="grid-2 stack-1"
          style={{
            marginTop: 28,
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            borderTop: '2px solid var(--color-divider)',
            borderLeft: '2px solid var(--color-divider)',
          }}
        >
          {MODEL_KEYS.keys.map((k) => (
            <li
              key={k.name}
              style={{
                borderRight: '2px solid var(--color-divider)',
                borderBottom: '2px solid var(--color-divider)',
                padding: '24px 28px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.01em' }}>{k.name}</span>
                <span className="tag tag-outline">{k.need}</span>
              </div>
              <p
                style={{
                  marginTop: 10,
                  fontSize: 15,
                  lineHeight: 1.5,
                  color: 'var(--color-neutral-800)',
                  textWrap: 'pretty',
                }}
              >
                {k.body}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* Capability matrix */}
      <section className="pad-x" style={{ padding: '56px 64px', borderBottom: '2px solid var(--color-divider)' }}>
        <h2 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 20 }}>
          What each provider supports
        </h2>
        <div className="scroll-x" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Capability</th>
                <th>Jira</th>
                <th>Azure DevOps</th>
                <th>GitHub</th>
                <th>Azure Repos</th>
              </tr>
            </thead>
            <tbody>
              {CAPABILITY_MATRIX.map((r) => (
                <tr key={r.cap}>
                  <td style={{ fontWeight: 700, color: 'var(--color-text)' }}>{r.cap}</td>
                  <td>{r.jira}</td>
                  <td>{r.ado}</td>
                  <td>{r.gh}</td>
                  <td>{r.ar}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Rendered from the shared constant. The page used to inline its own
            shorter footnote, so the corrected one reached nobody. */}
        <p
          style={{
            fontSize: 13,
            lineHeight: 1.6,
            color: 'var(--color-neutral-700)',
            marginTop: 16,
            maxWidth: 820,
            textWrap: 'pretty',
          }}
        >
          {CAPABILITY_FOOTNOTE}
        </p>
      </section>

      <section className="pad-x" style={{ padding: '56px 64px', borderBottom: '2px solid var(--color-divider)' }}>
        <h2 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em', maxWidth: 620, textWrap: 'balance' }}>
          We will connect the first one with you.
        </h2>
        <div style={{ marginTop: 24 }}>
          <Btn variant="primary" href="/contact">Book a walkthrough</Btn>
        </div>
      </section>
    </>
  );
}
