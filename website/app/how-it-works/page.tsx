import type { Metadata } from 'next';
import Link from 'next/link';
import PageHeader from '@/components/layout/PageHeader';
import Btn from '@/components/ui/Btn';
import { HOW_SECTIONS, STAGE_PHASES, LIMITS } from '@/lib/site';

export const metadata: Metadata = {
  title: 'How it works',
  description:
    'The eight stages of a run, grouped by what happens automatically and what waits for you to ask.',
};

/**
 * How it works.
 *
 * The previous version was eight identical rows in one list, which made a
 * reader assume the whole pipeline runs by itself — the same assumption the
 * marketing copy had picked up and published. The stages are now grouped by
 * what actually triggers them: four that run every time, one that covers
 * scheduling, and three that do nothing until someone presses a button. That
 * grouping is the page's real content; the prose underneath it has not moved
 * far.
 */
export default function HowItWorksPage() {
  return (
    <>
      <PageHeader
        title={<>A run is not a chat.<br />It&apos;s a pipeline.</>}
        lead="Eight discrete stages. Four of them run every time; three of them wait until you ask. If one fails, the run row says which, and nothing half-finished lands in your repository."
      />

      {STAGE_PHASES.map((phase) => {
        const stages = HOW_SECTIONS.filter((s) => s.phase === phase.key);
        return (
          <section key={phase.key} style={{ borderBottom: '2px solid var(--color-divider)' }}>
            {/* The phase banner is the one thing on this page that changes how
                the stages below it are read, so it gets real weight. */}
            <div
              className="pad-x"
              style={{
                padding: '36px 64px 28px',
                background: phase.key === 'ondemand' ? 'var(--color-accent-100)' : 'var(--color-neutral-100)',
                borderBottom: '2px solid var(--color-divider)',
              }}
            >
              <h2 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.025em' }}>{phase.label}</h2>
              <p
                style={{
                  marginTop: 8,
                  maxWidth: 680,
                  fontSize: 16,
                  lineHeight: 1.5,
                  color: 'var(--color-neutral-800)',
                  textWrap: 'pretty',
                }}
              >
                {phase.note}
              </p>
            </div>

            {stages.map((s) => (
              <article key={s.n} className={`stage-row${phase.key === 'ondemand' ? ' stage-ondemand' : ''}`}>
                <div className="stage-head">
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 13,
                      fontWeight: 700,
                      letterSpacing: '0.1em',
                      color: 'var(--color-accent-700)',
                    }}
                  >
                    {s.n}
                  </div>
                  <h3 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', marginTop: 8, textWrap: 'balance' }}>
                    {s.title}
                  </h3>
                  {/* The banner above scrolls away; this does not. Without it a
                      reader four stages down has no way to tell an on-demand
                      step from one that runs by itself. */}
                  {phase.key === 'ondemand' && (
                    <span className="tag tag-outline" style={{ marginTop: 12, display: 'inline-block' }}>
                      YOU TRIGGER THIS
                    </span>
                  )}
                </div>

                <div className="stage-body">
                  <p style={{ fontSize: 16, lineHeight: 1.6, color: 'var(--color-neutral-800)', textWrap: 'pretty' }}>
                    {s.body}
                  </p>
                </div>

                <div className="stage-detail">
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      letterSpacing: '0.12em',
                      color: 'var(--color-neutral-600)',
                      marginBottom: 10,
                    }}
                  >
                    {s.detailLabel}
                  </div>
                  <ul style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {s.details.map((d) => (
                      <li
                        key={d}
                        style={{
                          fontSize: 13.5,
                          lineHeight: 1.5,
                          color: 'var(--color-neutral-800)',
                          borderTop: '1px solid var(--color-neutral-300)',
                          paddingTop: 7,
                          textWrap: 'pretty',
                        }}
                      >
                        {d}
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            ))}
          </section>
        );
      })}

      {/* Limits. A governance buyer reads this before anything else on the
          page, and every line is checkable in the product. */}
      <section className="pad-x" style={{ padding: '64px 64px', borderBottom: '2px solid var(--color-divider)' }}>
        <h2 style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.025em' }}>What it will not do</h2>
        <p
          style={{
            marginTop: 12,
            maxWidth: 640,
            fontSize: 17,
            lineHeight: 1.5,
            color: 'var(--color-neutral-800)',
            textWrap: 'pretty',
          }}
        >
          The boundaries are the product. Each of these is something you can check rather than something you have to
          take on trust.
        </p>
        <ul
          className="grid-3 stack-1"
          style={{
            marginTop: 32,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            borderTop: '2px solid var(--color-divider)',
            borderLeft: '2px solid var(--color-divider)',
          }}
        >
          {LIMITS.map((l) => (
            <li
              key={l.title}
              style={{
                borderRight: '2px solid var(--color-divider)',
                borderBottom: '2px solid var(--color-divider)',
                padding: '24px 26px',
              }}
            >
              <h3 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>{l.title}</h3>
              <p
                style={{
                  marginTop: 7,
                  fontSize: 14.5,
                  lineHeight: 1.5,
                  color: 'var(--color-neutral-800)',
                  textWrap: 'pretty',
                }}
              >
                {l.body}
              </p>
            </li>
          ))}
        </ul>
        <p style={{ marginTop: 24, fontSize: 15 }}>
          <Link href="/trust/" style={{ color: 'var(--color-accent)', fontWeight: 700 }}>
            The full governance picture, with sub-processors and model disclosure →
          </Link>
        </p>
      </section>

      {/* One action, matching the homepage. */}
      <section className="pad-x" style={{ padding: '64px 64px', borderBottom: '2px solid var(--color-divider)' }}>
        <h2 style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.025em', maxWidth: 620, textWrap: 'balance' }}>
          Easier to watch than to read about.
        </h2>
        <div style={{ display: 'flex', gap: 12, marginTop: 26, flexWrap: 'wrap' }}>
          <Btn variant="primary" href="/contact">Book a walkthrough</Btn>
          <Btn variant="secondary" href="/#preview">Explore the demo</Btn>
        </div>
      </section>
    </>
  );
}
