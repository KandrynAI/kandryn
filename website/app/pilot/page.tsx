import type { Metadata } from 'next';
import ContactView from '@/components/ContactView';
import { PageHero, Section, LinkRow } from '@/components/marketing/ui';

export const metadata: Metadata = {
  alternates: { canonical: '/pilot/' },
  title: 'Discuss a pilot',
  description:
    'Bring a scoped request, its source rule, and an example of the expected result. We will discuss the project setup and how your team wants to evaluate the outcome.',
};

/**
 * The pilot inquiry.
 *
 * A separate route from /contact rather than a section on it, because the two
 * asks need different things from the reader: a walkthrough needs nothing
 * prepared, and a pilot needs a project, a repository and credentials.
 *
 * How a pilot actually runs, and what to measure while it does, is the pilot
 * guide's job. This page carries the short version and the form, so the two
 * do not drift into two different accounts of the same process. The form is
 * the real one: it posts to the same endpoint, and the pilot intent travels
 * in the message because the API's type field is a closed enum this project
 * cannot extend.
 */

const BRING: [string, string][] = [
  ['A scoped request', 'One work item whose meaning depends on a rule written somewhere else, small enough to review in one sitting.'],
  ['Its source rule', 'The policy, procedure or requirement that defines the expected behavior, and the document it lives in.'],
  ['An example', 'One input with the result your team would expect, so there is no argument about what correct means.'],
  ['A project and credentials', 'One tracker project bound to one repository, with tracker, repository and model access. A workspace admin can hold them for the team.'],
  ['Two reviewers', 'One who owns the business rule and one who owns the code. The pilot is a decision, and a decision needs the people who make it.'],
];

export default function PilotPage() {
  return (
    <>
      <PageHero
        eyebrow="Pilot"
        h1="Discuss a pilot on your work item."
        lead="Bring a scoped request, its source rule, and an example of the expected result. We will discuss the project setup and how your team wants to evaluate the outcome."
      />

      <Section h2="What to bring">
        <ul className="cols-3" style={{ marginTop: 28 }}>
          {BRING.map(([title, body]) => (
            <li key={title} className="panel panel-pad">
              <h3 className="h3">{title}</h3>
              <p className="body-2" style={{ marginTop: 8 }}>{body}</p>
            </li>
          ))}
        </ul>
        <p className="body-2" style={{ marginTop: 24, maxWidth: '62ch' }}>
          Kandryn opens a pull request on its own branch and stops there. Your team decides what merges, under the
          rules the repository already has.
        </p>
        <LinkRow
          links={[
            { label: 'How a pilot runs, step by step', href: '/pilot-guide' },
            { label: 'Lesson 3: evaluate a governed pilot', href: '/university/evaluate-a-governed-pilot' },
            { label: 'Trust & Security', href: '/trust/' },
          ]}
        />
      </Section>

      <Section quiet h2="Ask for a pilot">
        <div className="contact-split">
          <p className="body-2" style={{ maxWidth: '52ch' }}>
            We reply within one business day with a time and a short checklist. If you would rather see it before
            bringing a project of your own, switch the choice below to a walkthrough and we will screen-share a
            sample change instead.
          </p>
          <ContactView defaultIntent="pilot" />
        </div>
      </Section>
    </>
  );
}
