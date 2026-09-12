import type { Metadata } from 'next';
import PageHeader from '@/components/layout/PageHeader';
import Btn from '@/components/ui/Btn';
import { Section, Band, SectionHead, CellGrid, Cell } from '@/components/ui/Section';
import { CONNECTORS, MODEL_KEYS, CAPABILITY_MATRIX, CAPABILITY_FOOTNOTE } from '@/lib/site';

export const metadata: Metadata = {
  alternates: { canonical: '/integrations/' },
  title: 'Integrations',
  description:
    'What you connect, what each credential can reach, and which capabilities each provider supports.',
};

/**
 * Integrations.
 *
 * The page answers the question it is named for — what do I have to plug in? —
 * in the order someone does it: a tracker, a repository, the model keys the
 * agents run on, and optionally somewhere to publish runbooks. The six agents
 * used to sit here as peer cards beside Jira and GitHub, which buried the
 * connectors and duplicated /how-it-works.
 *
 * The layout is now the shared primitives rather than twenty-five inline
 * style objects, so the banner, grid and type scale match the rest of the site.
 */
export default function IntegrationsPage() {
  const groups = [...new Set(CONNECTORS.map((c) => c.kind))];

  return (
    <>
      <PageHeader
        title={<>Your tracker.<br />Your repository. Your keys.</>}
        lead="Kandryn stores every credential against your user record, tests it before it is saved, and tells you plainly what each one can reach."
      />

      {groups.map((group) => {
        const inGroup = CONNECTORS.filter((c) => c.kind === group);
        return (
          <div key={group}>
            <Band title={group} />
            <CellGrid cols={2}>
              {inGroup.map((c) => (
                <Cell
                  key={c.name}
                  title={c.name}
                  foot={
                    <>
                      <div
                        className="scroll-x"
                        style={{ overflowX: 'auto', fontFamily: 'var(--font-mono)', fontSize: 12 }}
                      >
                        {c.creds}
                      </div>
                      <div style={{ marginTop: 6 }}>{c.note}</div>
                    </>
                  }
                >
                  {c.body}
                </Cell>
              ))}
            </CellGrid>
          </div>
        );
      })}

      {/* The keys. Stated once, plainly — this is the setup step people get
          wrong, and the one the old page actively misled about. */}
      <Section>
        <SectionHead title={MODEL_KEYS.heading} lead={MODEL_KEYS.body} />
        <CellGrid cols={2} style={{ marginTop: 28 }}>
          {MODEL_KEYS.keys.map((k) => (
            <Cell key={k.name} title={k.name} tag={<span className="tag tag-outline">{k.need}</span>}>
              {k.body}
            </Cell>
          ))}
        </CellGrid>
      </Section>

      <Section>
        <SectionHead title="What each provider supports" />
        <div className="scroll-x" style={{ overflowX: 'auto', marginTop: 20 }}>
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
        <p className="meta" style={{ marginTop: 16, maxWidth: 820 }}>{CAPABILITY_FOOTNOTE}</p>
      </Section>

      <Section>
        <SectionHead display title="We will connect the first one with you." />
        <div style={{ marginTop: 24 }}>
          <Btn variant="primary" href="/contact">Book a walkthrough</Btn>
        </div>
      </Section>
    </>
  );
}
