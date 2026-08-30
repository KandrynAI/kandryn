import { HERO_STATS } from '@/lib/site';
import Btn from '@/components/ui/Btn';

export default function HeroSection() {
  return (
    <section
      className="stack-1"
      style={{
        display: 'grid',
        gridTemplateColumns: '1.35fr 1fr',
        borderBottom: '2px solid var(--color-divider)',
      }}
    >
      {/* LEFT */}
      <div className="pad-x" style={{ padding: '72px 64px 64px', borderRight: '2px solid var(--color-divider)' }}>
        <div className="kicker" style={{ marginBottom: 28 }}>
          AI delivery agent for Jira, Azure DevOps and GitHub
        </div>
        <h1
          className="h1-home"
          style={{ fontSize: 78, fontWeight: 900, letterSpacing: '-0.035em', lineHeight: 0.94 }}
        >
          The backlog
          <br />
          writes the code
          <br />
          back to you.
        </h1>
        <p
          style={{
            marginTop: 32,
            maxWidth: 620,
            fontSize: 19,
            fontWeight: 400,
            lineHeight: 1.5,
            color: 'var(--color-neutral-800)',
            textWrap: 'pretty',
          }}
        >
          Kandryn reads a work item the way an engineer does — hierarchy, acceptance criteria,
          the repository it belongs to — then runs four agents against it — Raptia and Fovea generate
          competing suggestions, Synthesia ranks them, and the pull request opens. Run it now, or queue
          tonight&apos;s work and read the diffs in the morning.
        </p>
        <div style={{ display: 'flex', gap: 14, marginTop: 40, flexWrap: 'wrap' }}>
          <Btn variant="primary" href="/contact">Request access</Btn>
          <Btn variant="secondary" href="/how-it-works">See how it works</Btn>
        </div>
        <p style={{ marginTop: 28, fontSize: 13, color: 'var(--color-neutral-700)' }}>
          No agent runs without your credentials, and none of them leave your repository.
        </p>
      </div>

      {/* RIGHT — four stat cells */}
      <div style={{ display: 'grid', gridTemplateRows: 'repeat(4, 1fr)' }}>
        {HERO_STATS.map((s) => (
          <div key={s.value} style={{ padding: '28px 40px', borderBottom: '2px solid var(--color-divider)' }}>
            <div style={{ fontSize: 44, fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 14, color: 'var(--color-neutral-700)', marginTop: 6 }}>{s.body}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
