import type { Metadata } from 'next';
import PageHeader from '@/components/layout/PageHeader';
import ContactView from '@/components/ContactView';
import { CellGrid, Cell } from '@/components/ui/Section';

export const metadata: Metadata = {
  alternates: { canonical: '/pilot/' },
  title: 'Pilot on one work item',
  description:
    'Bring a ticket whose meaning depends on something written elsewhere. We run it end to end with you and you keep whatever it produces.',
};

/**
 * The pilot path.
 *
 * A separate route rather than a section on /contact, because the two asks
 * need different things from the reader: a walkthrough needs nothing
 * prepared, and a pilot needs a project, a repository and credentials. Putting
 * both on one page meant the credential list greeted every sponsor who only
 * wanted to see the product, which is why it used to sit under "You'll need"
 * on the contact page and now lives here.
 *
 * Built entirely from existing components. The form is the real one: it posts
 * to the same endpoint, and the pilot intent travels in the message because
 * the API's type field is a closed enum this project cannot extend.
 */

const BRING: [string, string][] = [
  ['One tracker project', 'Jira or Azure DevOps, with the hierarchy you already keep.'],
  ['One repository', 'GitHub or Azure Repos. GitHub is the primary provider.'],
  ['One real work item', 'Not a toy ticket. Something whose meaning depends on a rule written somewhere else.'],
  ['The documents that define its rules', 'Markdown, plain text, CSV, PDF or Word. They are read as background, and the acceptance criteria still govern.'],
  ['Credentials', 'Tracker, repository and model API keys. A workspace admin can hold them for the team, or each person can use their own.'],
];

const PRODUCE: [string, string][] = [
  ['The context it found', 'What the run read: the parent items, the repository files and the document passages, recorded as identifiers and counts.'],
  ['A proposed change', 'Committed to its own branch as a pull request, for your normal review and your normal CI.'],
  ['A security scan', 'Run it on the committed change and it posts a status check your branch rules can require.'],
  ['A runbook', 'Generated on request, and pushed to your documentation tool or committed to the branch.'],
];

/**
 * Measures, never results.
 *
 * No number is promised anywhere on this page. These are the three things
 * worth timing during a pilot so that both teams are measuring the same thing
 * afterwards.
 */
const MEASURES = [
  'Time from the request landing to a proposal your team can review.',
  'Engineer time spent clarifying what the request actually meant.',
  'Corrections needed before the change is accepted.',
];

export default function PilotPage() {
  return (
    <>
      <PageHeader
        kicker="Pilot"
        title="Bring a ticket whose meaning depends on something written elsewhere."
        lead="One work item, run end to end, with your team watching. The point is not to see Kandryn write code. It is to see whether the context it assembled was the context your engineer would have gone looking for."
      />

      <section className="pad-x" style={{ padding: '56px 64px', borderBottom: '2px solid var(--color-divider)' }}>
        <h2 style={{ fontSize: 34, fontWeight: 600, lineHeight: 1.15, letterSpacing: '-0.018em' }}>What you bring</h2>
        <CellGrid cols={3} style={{ marginTop: 30 }}>
          {BRING.map(([title, body]) => (
            <Cell key={title} title={title}>
              {body}
            </Cell>
          ))}
        </CellGrid>
      </section>

      <section className="pad-x" style={{ padding: '56px 64px', borderBottom: '2px solid var(--color-divider)' }}>
        <h2 style={{ fontSize: 34, fontWeight: 600, lineHeight: 1.15, letterSpacing: '-0.018em' }}>
          What Kandryn produces
        </h2>
        <CellGrid cols={4} style={{ marginTop: 30 }}>
          {PRODUCE.map(([title, body]) => (
            <Cell key={title} title={title}>
              {body}
            </Cell>
          ))}
        </CellGrid>
        <p className="meta" style={{ marginTop: 20, maxWidth: 680 }}>
          Kandryn opens the pull request and stops. Your team decides what merges.
        </p>
      </section>

      <section className="pad-x" style={{ padding: '56px 64px', borderBottom: '2px solid var(--color-divider)' }}>
        <h2 style={{ fontSize: 34, fontWeight: 600, lineHeight: 1.15, letterSpacing: '-0.018em' }}>
          What both teams evaluate
        </h2>
        <p
          style={{
            marginTop: 12,
            maxWidth: 660,
            fontSize: 17,
            lineHeight: 1.6,
            color: 'var(--color-neutral-800)',
            textWrap: 'pretty',
          }}
        >
          Agree these before the pilot starts, and measure them against how the same work goes today. We publish no
          figures of our own, because the only ones worth anything are the ones from your own backlog.
        </p>
        <ul style={{ marginTop: 26, display: 'grid', gap: 10, maxWidth: 660 }}>
          {MEASURES.map((m) => (
            <li
              key={m}
              style={{
                borderTop: '2px solid var(--color-divider)',
                paddingTop: 10,
                fontSize: 16,
                lineHeight: 1.6,
                color: 'var(--color-neutral-800)',
              }}
            >
              {m}
            </li>
          ))}
        </ul>
      </section>

      <section
        className="pad-x stack-1"
        style={{
          padding: '56px 64px',
          borderBottom: '2px solid var(--color-divider)',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 48,
        }}
      >
        <div>
          <h2 style={{ fontSize: 34, fontWeight: 600, lineHeight: 1.15, letterSpacing: '-0.018em' }}>
            Ask for a pilot
          </h2>
          <p
            style={{
              marginTop: 12,
              fontSize: 17,
              lineHeight: 1.6,
              color: 'var(--color-neutral-800)',
              textWrap: 'pretty',
            }}
          >
            We reply within one business day with a time and a short checklist. If you would rather see it before
            bringing a project, switch the choice to a walkthrough and we will screen-share it instead.
          </p>
        </div>
        <ContactView defaultIntent="pilot" />
      </section>
    </>
  );
}
