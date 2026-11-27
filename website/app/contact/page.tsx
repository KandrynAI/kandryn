import type { Metadata } from 'next';
import ContactView from '@/components/ContactView';
import { PageHero, Section, LinkRow } from '@/components/marketing/ui';

export const metadata: Metadata = {
  alternates: { canonical: '/contact/' },
  title: 'Request a walkthrough',
  description:
    'Choose an industry or tell us about a request your team is considering, and we will show how business context shapes the proposal and what your reviewers can inspect.',
};

/**
 * The walkthrough request.
 *
 * A walkthrough needs nothing prepared, so this page asks for nothing: the
 * credential list lives on /pilot, where it is actually needed. The two asks
 * stayed on one page for a long time and the effect was that every sponsor
 * who only wanted to see the product was greeted by a list of API keys.
 *
 * The form is the same component /pilot uses, with the intent defaulted the
 * other way, so there is one transport, one validation rule and one failure
 * path to keep correct.
 */
const FACTS: [string, string][] = [
  ['Typical reply', 'Within one business day, with a time and a short checklist.'],
  ['To prepare', 'Nothing. We screen-share a sample change and answer questions as they come up.'],
  ['What you will see', 'The context a run assembles, the change it proposes, and what a reviewer inspects before deciding.'],
  ['If you would rather bring your own work item', 'Switch the choice in the form to a pilot, or read the pilot guide first.'],
];

export default function ContactPage() {
  return (
    <>
      <PageHero
        eyebrow="Walkthrough"
        h1="See Kandryn work through a business change."
        lead="Choose an industry or tell us about a request your team is considering. We will use a sample change to show how business context shapes the proposal and what your reviewers can inspect."
      />

      <Section>
        <div className="contact-split">
          <div>
            <div className="rows">
              {FACTS.map(([lead, body]) => (
                <p key={lead} className="body-2">
                  <strong style={{ fontWeight: 700, color: 'var(--color-text)' }}>{lead}.</strong> {body}
                </p>
              ))}
            </div>
            <LinkRow
              links={[
                { label: 'Explore your industry', href: '/industries' },
                { label: 'Read the pilot guide', href: '/pilot-guide' },
              ]}
            />
          </div>
          <ContactView />
        </div>
      </Section>
    </>
  );
}
