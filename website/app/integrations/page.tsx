import type { Metadata } from 'next';
import PageHeader from '@/components/layout/PageHeader';
import { INTEGRATIONS, CAPABILITY_MATRIX } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Integrations',
  description: 'Your tracker, your repository, your keys. Every credential is stored against your user and tested before it is saved.',
};

function roleClass(tag: string) {
  return tag.includes('MODEL') || tag.includes('PRIMARY') ? 'tag tag-accent' : 'tag tag-outline';
}

export default function IntegrationsPage() {
  return (
    <>
      <PageHeader
        title={<>Your tracker.<br />Your repository. Your keys.</>}
        lead="Kandryn stores every credential against your user record, tests it before it's saved, and tells you plainly what each one can reach."
      />

      {/* Connectors */}
      <div
        className="grid-2 stack-1"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', borderLeft: '2px solid var(--color-divider)' }}
      >
        {INTEGRATIONS.map((c) => (
          <div key={c.name} style={{ borderRight: '2px solid var(--color-divider)', borderBottom: '2px solid var(--color-divider)', padding: '32px 40px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em' }}>{c.name}</span>
              <span className={roleClass(c.tag)}>{c.tag}</span>
            </div>
            <p style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--color-neutral-800)', marginTop: 12, textWrap: 'pretty' }}>{c.body}</p>
            <div style={{ marginTop: 16, borderTop: '1px solid var(--color-neutral-300)', paddingTop: 12, fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--color-neutral-700)' }}>
              {c.creds}
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-neutral-700)', marginTop: 8 }}>{c.note}</div>
          </div>
        ))}
      </div>

      {/* Capability matrix */}
      <section className="pad-x" style={{ padding: '56px 64px', borderBottom: '2px solid var(--color-divider)' }}>
        <h2 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 20 }}>Capability matrix</h2>
        <div style={{ overflowX: 'auto' }}>
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
        <p style={{ fontSize: 13, color: 'var(--color-neutral-700)', marginTop: 14, maxWidth: 720 }}>
          GitHub is the primary, auto-synced provider. On Azure Repos, commits edit existing files — adding a brand-new file can fail.
        </p>
      </section>
    </>
  );
}
