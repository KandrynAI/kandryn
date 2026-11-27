import type { Metadata } from 'next';
import PageHeader from '@/components/layout/PageHeader';
import Btn from '@/components/ui/Btn';
import { Section, Band, SectionHead, CellGrid, Cell } from '@/components/ui/Section';
import { CONNECTORS, MODEL_KEYS, CAPABILITY_MATRIX, CAPABILITY_FOOTNOTE } from '@/lib/site';

export const metadata: Metadata = {
  alternates: { canonical: '/integrations/' },
  title: 'Integrations',
  description:
    'Connect a tracker project to its repository. What each provider supports, what each credential can reach, and where the limits are.',
};

/**
 * Integrations.
 *
 * The capability matrix leads, because it is the only thing on the page that
 * answers "will this work with what we already run" without reading prose.
 * The detail then follows in the order a team connects things: the tracker
 * where work is defined, the repository where it lands, the optional place
 * runbooks are published, and the model keys every agent runs on.
 *
 * Azure Boards and Azure Repos are two connections with two credentials and
 * are named separately throughout. They used to share the label "Azure
 * DevOps", which reads as one switch.
 */

/** The four groups, in connection order, with what each one is for. */
const GROUP_NOTES: Record<string, string> = {
  'Work Tracking': 'Pick one. This is where the work item, its hierarchy and its acceptance criteria come from.',
  'Source Control': 'Pick one. This is where the branch, the commit and the pull request land.',
  Documentation: 'Optional. A destination for generated runbooks. Without either, a runbook still goes to the pull request branch as Markdown.',
};

/**
 * One tracker times one repository provider. Stated as four cells rather than
 * a sentence, because "any combination" is the kind of claim a reader wants
 * to see enumerated. The Azure Repos caveats are the verified ones and they
 * travel with the cell that carries them.
 */
const COMBINATIONS = [
  { title: 'Jira and GitHub', body: 'The primary pairing. Everything the product does is supported here, including posting the security status check against a commit.' },
  { title: 'Jira and Azure Repos', body: 'Branches, commits to existing files, pull requests, stack detection and the security gate. Adding a brand-new file can fail, and the gate needs a pull request to attach to.' },
  { title: 'Azure Boards and GitHub', body: 'Work item hierarchy from Azure Boards, with the full GitHub write path. Backlog rank is read, so run-order checks can use it.' },
  { title: 'Azure Boards and Azure Repos', body: 'Both halves on Azure DevOps, still two separate credentials, with the same Azure Repos caveats on new files and on where the gate can post.' },
];

export default function IntegrationsPage() {
  const groups = [...new Set(CONNECTORS.map((c) => c.kind))];

  return (
    <>
      <PageHeader
        title="Connect the tools where your team defines and reviews work."
        lead="Connect a tracker project to its repository so Kandryn can read the request, gather project context, and prepare a change for review. Every credential is stored against your user record or held by your workspace admin, tested before it is saved, and the page below says plainly what each one can reach."
      />

      {/* The matrix leads. It is the fastest answer to "does this work with
          what we run", and it used to sit below two screens of prose. */}
      <Section>
        <SectionHead
          title="What each provider supports"
          lead="Azure Boards is the tracker. Azure Repos is the repository. They are listed separately because they are two connections with two credentials."
        />
        <div className="scroll-x" style={{ overflowX: 'auto', marginTop: 20 }}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Capability</th>
                <th scope="col">Jira</th>
                <th scope="col">Azure Boards</th>
                <th scope="col">GitHub</th>
                <th scope="col">Azure Repos</th>
              </tr>
            </thead>
            <tbody>
              {CAPABILITY_MATRIX.map((r) => (
                <tr key={r.cap}>
                  <th scope="row" style={{ fontWeight: 700, color: 'var(--color-text)' }}>{r.cap}</th>
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
        <SectionHead title="Supported combinations" />
        <CellGrid cols={4} style={{ marginTop: 24 }}>
          {COMBINATIONS.map((c) => (
            <Cell key={c.title} title={c.title}>
              {c.body}
            </Cell>
          ))}
        </CellGrid>
      </Section>

      {groups.map((group) => {
        const inGroup = CONNECTORS.filter((c) => c.kind === group);
        return (
          <div key={group}>
            <Band title={group} note={GROUP_NOTES[group]} />
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

      {/* The fourth group. Its own shape rather than a connector card: there
          is no provider to name here, and the setup step people get wrong is
          whose account the usage lands on. */}
      <Band title="Model Access" note={MODEL_KEYS.body} />
      <Section>
        <CellGrid cols={2}>
          {MODEL_KEYS.keys.map((k) => (
            <Cell key={k.name} title={k.name} tag={<span className="tag tag-outline">{k.need}</span>}>
              {k.body}
            </Cell>
          ))}
        </CellGrid>
      </Section>

      <Section bare>
        <SectionHead display title="We will connect the first one with you." />
        <div style={{ marginTop: 24 }}>
          <Btn variant="primary" href="/contact">Request a walkthrough</Btn>
        </div>
      </Section>
    </>
  );
}
