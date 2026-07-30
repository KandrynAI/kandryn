import type { Metadata } from 'next';
import PageHeader from '@/components/layout/PageHeader';
import { HOW_SECTIONS, ATTENTION } from '@/lib/site';

export const metadata: Metadata = {
  title: 'How it works',
  description: 'A run is not a chat — it is a pipeline. Every stage is a discrete, inspectable step.',
};

export default function HowItWorksPage() {
  return (
    <>
      <PageHeader
        title={<>A run is not a chat.<br />It&apos;s a pipeline.</>}
        lead="Every stage below is a discrete, inspectable step. If one fails, the run row says which, and nothing half-finished lands in your repository."
      />

      {HOW_SECTIONS.map((s) => (
        <div
          key={s.n}
          className="stack-1"
          style={{ display: 'grid', gridTemplateColumns: '220px 1fr 1fr', borderBottom: '2px solid var(--color-divider)' }}
        >
          <div style={{ padding: '40px 24px 40px 64px', borderRight: '2px solid var(--color-divider)' }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.12em', color: 'var(--color-accent-700)' }}>{s.n}</div>
            <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-0.02em', marginTop: 10 }}>{s.title}</div>
          </div>
          <div style={{ padding: '40px 32px', borderRight: '2px solid var(--color-divider)', fontSize: 16, lineHeight: 1.55, color: 'var(--color-neutral-800)', textWrap: 'pretty' }}>
            {s.body}
          </div>
          <div style={{ padding: '40px 64px 40px 32px' }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', color: 'var(--color-neutral-600)', marginBottom: 12 }}>
              {s.detailLabel}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {s.details.map((d) => (
                <div key={d} style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--color-neutral-800)', borderTop: '1px solid var(--color-neutral-300)', paddingTop: 8 }}>
                  {d}
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}

      {/* Attention */}
      <section className="pad-x" style={{ padding: '56px 64px', borderBottom: '2px solid var(--color-divider)' }}>
        <h2 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 24 }}>
          What a run costs you in attention
        </h2>
        <div
          className="grid-3 stack-1"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', borderTop: '2px solid var(--color-divider)', borderLeft: '2px solid var(--color-divider)' }}
        >
          {ATTENTION.map((a) => (
            <div key={a.value} style={{ borderRight: '2px solid var(--color-divider)', borderBottom: '2px solid var(--color-divider)', padding: 28 }}>
              <div style={{ fontSize: 40, fontWeight: 900, letterSpacing: '-0.03em' }}>{a.value}</div>
              <div style={{ fontSize: 14, color: 'var(--color-neutral-700)', marginTop: 8 }}>{a.body}</div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
