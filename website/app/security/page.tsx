import type { Metadata } from 'next';
import PageHeader from '@/components/layout/PageHeader';
import { SECURITY_PRINCIPLES, PROCESSORS } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Security',
  description: 'Least privilege, stated plainly. What Kandryn holds, what it touches, and what it refuses to do.',
};

export default function SecurityPage() {
  return (
    <>
      <PageHeader
        title={<>Least privilege,<br />stated plainly.</>}
        lead="Kandryn is a delivery tool with write access to your repository. Here is exactly what it holds, what it touches, and what it refuses to do."
      />

      {/* Principles */}
      <div
        className="grid-2 stack-1"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', borderLeft: '2px solid var(--color-divider)' }}
      >
        {SECURITY_PRINCIPLES.map((p) => (
          <div key={p.title} style={{ borderRight: '2px solid var(--color-divider)', borderBottom: '2px solid var(--color-divider)', padding: '32px 40px', minHeight: 180 }}>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.01em' }}>{p.title}</div>
            <p style={{ fontSize: 15, lineHeight: 1.55, color: 'var(--color-neutral-800)', marginTop: 10, textWrap: 'pretty' }}>{p.body}</p>
          </div>
        ))}
      </div>

      {/* Processors */}
      <section className="pad-x" style={{ padding: '56px 64px', borderBottom: '2px solid var(--color-divider)' }}>
        <h2 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 20 }}>Where your data sits</h2>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Processor</th>
                <th>Purpose</th>
                <th>What it sees</th>
              </tr>
            </thead>
            <tbody>
              {PROCESSORS.map((p) => (
                <tr key={p.name}>
                  <td style={{ fontWeight: 700, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>{p.name}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{p.purpose}</td>
                  <td>{p.sees}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 32, padding: '16px 20px', borderLeft: '2px solid var(--color-accent)', background: 'var(--color-accent-100)' }}>
          <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--color-text)', margin: 0, maxWidth: 760 }}>
            For a complete security overview including sub-processor list, compliance status, AI model disclosure, and
            audit log details —
          </p>
          <a href="/trust/" style={{ fontSize: 14, color: 'var(--color-accent)', fontWeight: 700, display: 'inline-block', marginTop: 6 }}>
            View our Trust and Security page →
          </a>
        </div>
      </section>
    </>
  );
}
