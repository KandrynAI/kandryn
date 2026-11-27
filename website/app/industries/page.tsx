import type { Metadata } from 'next';
import { PageHero, Section, LinkGrid, CtaBlock } from '@/components/marketing/ui';
import { INDUSTRIES } from '@/lib/content/industries';
import { INDUSTRY_LINKS } from '@/lib/nav';

export const metadata: Metadata = {
  alternates: { canonical: '/industries/' },
  title: 'Industries',
  description:
    'The same words can carry different operational meanings. See how Kandryn connects software requests to the definitions your organization uses, across six industries.',
};

export default function IndustriesPage() {
  return (
    <>
      <PageHero
        eyebrow="Industries"
        h1="Software changes grounded in the way your industry works."
        lead="The same words can carry different operational meanings. A case can be referred, authorized, assigned, or closed. A claim can be open while its review clock is paused. Explore how Kandryn connects requests to the definitions your organization uses."
      />
      <Section>
        <h2 className="h2">Choose the work you recognize.</h2>
        <p className="lead-2">
          Each page carries one request, the rule that changes the answer, and the two reviews that decide whether the
          change is right. Every example is invented for illustration.
        </p>
        <LinkGrid items={INDUSTRY_LINKS} />
      </Section>
      <Section quiet>
        <h2 className="h2">One pattern, six vocabularies.</h2>
        <p className="lead-2">
          In all {INDUSTRIES.length} examples the ticket is reasonable and the data is available. What decides the
          result is a definition written somewhere other than the ticket: the event a wait starts from, the status that
          means a handoff, the discount allocated to a line, the exception that needs a second approver, the pause in a
          review clock, the date that selects a plan version.
        </p>
      </Section>
      <CtaBlock
        h2="Bring a request whose meaning depends on a rule written somewhere else."
        body="Choose one improvement your team wants to make. We will walk through the context behind it, the proposed change, and the decisions your reviewers would make."
        secondary={{ label: 'See the pilot guide', href: '/pilot-guide' }}
      />
    </>
  );
}
