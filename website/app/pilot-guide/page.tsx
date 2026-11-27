import type { Metadata } from 'next';
import { PageHero, Section, CtaBlock, LinkRow } from '@/components/marketing/ui';
import PilotScorecard from '@/components/marketing/PilotScorecard';

export const metadata: Metadata = {
  alternates: { canonical: '/pilot-guide/' },
  title: 'Pilot Guide',
  description:
    'Evaluate Kandryn on one work item your team understands: what to bring, what to prepare, how to review the result, and how to decide together.',
};

const STEPS = [
  {
    h: 'Choose the work.',
    body:
      'One scoped item, the rule that defines it, one example with an expected result, and the two people who will review it. A request whose meaning is obvious from the ticket alone will not tell you much: the point is to see what Kandryn does with a rule written somewhere else.',
  },
  {
    h: 'Prepare the project.',
    body:
      'One tracker project bound to one repository. Credentials for both, held by a workspace admin or by each person. Model access for the generation agents. Optionally, the documents that define the rule, so the run can retrieve the passages that bear on the item.',
  },
  {
    h: 'Run and review.',
    body:
      'Start a run on the item. Examine the context it recorded, read the proposed change, run the checks you want, and note every correction a reviewer asks for. The corrections are the most useful thing a pilot produces.',
  },
  {
    h: 'Decide together.',
    body:
      'Compare the result with the criteria you agreed at the start. Record the decision and who made it. A pilot that ends without a written decision tends to be remembered differently by each person who was in the room.',
  },
];

export default function PilotGuidePage() {
  return (
    <>
      <PageHero
        eyebrow="Pilot"
        h1="Evaluate Kandryn on one work item your team understands."
        lead="Bring a request whose meaning depends on a rule written somewhere else. A useful pilot lets your team judge the context Kandryn identifies, the implementation it proposes, and the effort required to reach a decision."
      />

      <Section h2="How a pilot runs">
        <ol style={{ display: 'grid', gap: 22, marginTop: 30 }}>
          {STEPS.map((s, i) => (
            <li key={s.h} className="panel panel-pad" style={{ display: 'grid', gridTemplateColumns: '44px minmax(0,1fr)', gap: 18 }}>
              <span
                aria-hidden="true"
                style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-accent)', paddingTop: 2 }}
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <div>
                <h3 className="h3">{s.h}</h3>
                <p className="body-2" style={{ marginTop: 8 }}>{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section quiet h2="Keep score">
        <p className="lead-2">
          Agree what you are measuring before the pilot starts. These six rows are enough, and the blank version is
          the one to fill in.
        </p>
        <div style={{ marginTop: 28 }}>
          <PilotScorecard />
        </div>
      </Section>

      <Section h2="Before you start">
        <p className="lead-2">
          A walkthrough needs nothing prepared: we screen-share a sample change and answer questions. A pilot needs
          the project and credentials above, because it runs on your own work item.
        </p>
        <LinkRow
          links={[
            { label: 'Lesson 3: evaluate a governed pilot', href: '/university/evaluate-a-governed-pilot' },
            { label: 'Trust & Security', href: '/trust/' },
            { label: 'Integrations', href: '/integrations' },
          ]}
        />
      </Section>

      <CtaBlock
        h2="Discuss a pilot."
        body="Bring a scoped request, its source rule, and an example of the expected result. We will discuss the project setup and how your team wants to evaluate the outcome."
        primary={{ label: 'Discuss a pilot', href: '/pilot' }}
        secondary={{ label: 'Request a walkthrough', href: '/contact' }}
      />
    </>
  );
}
