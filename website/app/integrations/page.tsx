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
/**
 * One tracker times one repository provider. Stated as four cells rather than
 * a sentence, because "any combination" is the kind of claim a reader wants
 * to see enumerated. The Azure Repos caveats are the verified ones and they
 * travel with the cell that carries them.
 */
const COMBINATIONS = [
  { title: 'Jira and GitHub', body: 'The primary pairing. Everything the product does is supported here, including posting the security status check against a commit.' },
  { title: 'Jira and Azure Repos', body: 'Branches, commits to existing files, pull requests, stack detection and the security gate. Adding a brand-new file can fail, and the gate needs a pull request to attach to.' },
  { title: 'Azure DevOps and GitHub', body: 'Work item hierarchy from Azure Boards, with the full GitHub write path. Backlog rank is read, so run-order checks can use it.' },
  { title: 'Azure DevOps and Azure Repos', body: 'Both halves on Azure, with the same Azure Repos caveats on new files and on where the gate can post.' },
];

export default function IntegrationsPage() {
  const groups = [...new Set(CONNECTORS.map((c) => c.kind))];

  return (
    <>
      <PageHeader
        title="Your tracker. Your repository. Your keys."
        lead="Kandryn binds one tracker project to one repository. Jira or Azure DevOps for the work, GitHub or Azure Repos for the code, in any of the four combinations. Every credential is stored against your user record, tested before it is saved, and the page below says plainly what each one can reach."
      />

      {/* The four combinations, before the connector detail. It is the first
          question a buyer asks and it used to be answerable only by reading
          two tables and doing the multiplication yourself. */}
      <section className="pad-x" style={{ padding: '44px 64px', borderBottom: '2px solid var(--color-divider)' }}>
        <h2 style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.2, letterSpacing: '-0.012em' }}>
          Supported combinations
        </h2>
        <CellGrid cols={4} style={{ marginTop: 24 }}>
          {COMBINATIONS.map((c) => (
            <Cell key={c.title} title={c.title}>
              {c.body}
            </Cell>
          ))}
        </CellGrid>
      </section>

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
