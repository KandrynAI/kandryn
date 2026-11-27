import type { Metadata } from 'next';
import { PageHero, Section, CtaBlock } from '@/components/marketing/ui';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  alternates: { canonical: '/company/' },
  title: 'Company',
  description:
    'Kandryn builds software delivery tools for teams whose work depends on business rules, operating procedures, and domain knowledge.',
};

export default function CompanyPage() {
  return (
    <>
      <PageHero
        eyebrow="Company"
        h1="About Kandryn."
        lead="Kandryn builds software delivery tools for teams whose work depends on business rules, operating procedures, and domain knowledge."
      />
      <Section>
        <p className="lead-2" style={{ marginTop: 0 }}>
          Our focus is the point where a business request becomes an engineering decision. Kandryn brings the relevant
          project context into that decision and gives the team a proposed change to review.
        </p>
      </Section>
      <Section quiet h2="Get in touch">
        <p className="lead-2">
          For product questions, a walkthrough, or a pilot, use the contact form. For security and privacy questions,
          the Trust page carries the current contact details and status.
        </p>
        <p style={{ marginTop: 20, fontSize: 16 }}>
          <a href={`mailto:${SITE.email}`} className="arrowlink">{SITE.email}</a>
        </p>
      </Section>
      <CtaBlock
        h2="See Kandryn work through a business change."
        body="Choose an industry or tell us about a request your team is considering."
        secondary={{ label: 'Trust & Security', href: '/trust/' }}
      />
    </>
  );
}
