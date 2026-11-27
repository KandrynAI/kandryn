import type { Metadata } from 'next';
import { PageHero, Section, WorkedExample, ReviewPair, CtaBlock, LinkGrid } from '@/components/marketing/ui';
import { ReviewClock } from '@/components/marketing/visuals';
import { INDUSTRY_LINKS } from '@/lib/nav';

export const metadata: Metadata = {
  alternates: { canonical: '/platform/business-domain-context/' },
  title: 'Business & Domain Context',
  description:
    'A ticket says what someone wants. Kandryn identifies the requirements, procedures and code the request depends on, and builds the relevant context for each proposed change.',
};

export default function BusinessDomainContextPage() {
  return (
    <>
      <PageHero
        eyebrow="Platform"
        h1="Bring the meaning behind a request into the software change."
        lead="A ticket describes what someone wants. A parent initiative may explain why it matters. A procedure may define an exception, and the existing code determines where the change belongs. Kandryn identifies those connections and builds the relevant context for each proposed change."
      />

      <Section h2="Your organization defines the rule.">
        <p className="lead-2">
          Two insurers can use the same term and measure it differently. Kandryn works with the requirements,
          procedures, and project materials your team supplies. Your business owners remain the authority on what those
          sources mean.
        </p>
      </Section>

      <Section quiet h2="From documented intent to a reviewable change.">
        <p className="lead-2">
          The work item supplies the acceptance criteria. Related stories and initiatives supply the background.
          Selected document passages and repository files help ground the proposal in the project. When background
          material and the work item disagree, the acceptance criteria govern the run.
        </p>

        <WorkedExample
          heading="One rule changes the answer."
          rows={[
            ['Request', 'Show the number of days a claim spent in review.'],
            ['Source', 'Sample claims operations guide'],
            ['Operating rule', 'Pause the review clock while requested documents are outstanding.'],
          ]}
          visual={
            <ReviewClock
              caption="The ticket is reasonable and the data is available. The definition decides the number."
              segments={[
                { days: 2, label: 'In review', counts: true },
                { days: 3, label: 'Waiting for documents', counts: false },
                { days: 1, label: 'In review', counts: true },
              ]}
            />
          }
        />
      </Section>

      <Section h2="What stays current.">
        <p className="lead-2">
          Kandryn refreshes its repository view as commits land. For each run, it selects the context relevant to that
          work item and records references to the material used. Your team maintains its source policies and
          requirements.
        </p>
        <div className="panel panel-pad" style={{ marginTop: 26 }}>
          <h3 className="h3">What the product records, and what it does not</h3>
          <p className="body-2" style={{ marginTop: 12 }}>
            A run records identifiers and counts for the material it used: which parent items, how many document
            passages, and whether the project styling was applied. It does not store the passage text in that record.
            The excerpts shown in the examples on this site are written for illustration and are not what the product
            keeps.
          </p>
        </div>
      </Section>

      <Section quiet h2="What reviewers can inspect.">
        <p className="lead-2">
          A business reviewer can check whether the example satisfies the request. An engineer can inspect the proposed
          code, its fit with the repository, and the recorded context. The review begins with a shared question: does
          this change implement the intended rule?
        </p>
        <ReviewPair
          business="Does this match the way we measure review time, and does it answer the request we made?"
          engineering="Does the calculation exclude waiting periods, resume when review restarts, and fit the code around it?"
        />
      </Section>

      <Section h2="See it in your industry.">
        <p className="lead-2">
          Each page carries one request, the rule that changes the answer, and the two reviews that decide whether the
          change is right.
        </p>
        <LinkGrid items={INDUSTRY_LINKS} />
      </Section>

      <CtaBlock
        h2="Bring a request whose meaning depends on a rule written somewhere else."
        body="Choose one improvement your team wants to make. We will walk through the context behind it, the proposed change, and the decisions your reviewers would make."
        secondary={{ label: 'See the pilot guide', href: '/pilot-guide' }}
      />
    </>
  );
}
