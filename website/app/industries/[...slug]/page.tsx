import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHero, Section, WorkedExample, ReviewPair, CtaBlock, LinkRow } from '@/components/marketing/ui';
import { INDUSTRIES, industryBySlug } from '@/lib/content/industries';

/**
 * One template, six pages.
 *
 * A catch-all rather than two route folders, because two of the six sit
 * under /industries/government/ and four sit directly under /industries/.
 * Splitting them would mean the same template maintained twice.
 */

type Params = { slug: string[] };

export function generateStaticParams(): Params[] {
  return INDUSTRIES.map((i) => ({ slug: i.slug.split('/') }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const industry = industryBySlug(slug.join('/'));
  if (!industry) return {};
  return {
    alternates: { canonical: `/industries/${industry.slug}/` },
    title: industry.metaTitle,
    description: industry.metaDescription,
  };
}

export default async function IndustryPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const industry = industryBySlug(slug.join('/'));
  if (!industry) notFound();

  const others = INDUSTRIES.filter((i) => i.slug !== industry.slug).slice(0, 3);

  return (
    <>
      <PageHero eyebrow="Industries" h1={industry.h1} lead={industry.lead}>
        <p style={{ marginTop: 22 }}>
          <Link href="/industries" className="arrowlink">
            All industries &rarr;
          </Link>
        </p>
      </PageHero>

      <Section h2={industry.exampleHeading} lead={industry.example}>
        <WorkedExample
          heading={industry.exampleHeading}
          rows={industry.rows}
          result={industry.result}
          visual={industry.visual}
        />
        <ReviewPair business={industry.businessReview} engineering={industry.engineeringReview} />
      </Section>

      <Section quiet h2="What Kandryn does with it">
        <p className="lead-2">
          Kandryn reads the work item and its acceptance criteria, follows it to the initiative above it, and selects
          the document passages and repository files that bear on the change. It prepares a proposed implementation in
          the repository your project is connected to. Your reviewers decide whether it ships.
        </p>
        <LinkRow
          links={[
            { label: 'How business and domain context is built', href: '/platform/business-domain-context' },
            { label: 'How review and governance works', href: '/platform/review-governance' },
          ]}
        />
      </Section>

      <Section h2="Other industries">
        <ul className="cols-3" style={{ marginTop: 28 }}>
          {others.map((o) => (
            <li key={o.slug}>
              <Link href={`/industries/${o.slug}`} className="card-link">
                <span className="h3" style={{ display: 'block' }}>{o.label}</span>
                <span className="body-2" style={{ display: 'block', marginTop: 8 }}>{o.exampleHeading}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      {/* The industry travels to the form as ?topic=, where it prefills a
          field the visitor can see and edit. A reader who clicked through
          from P&C should not have to retype "P&C". */}
      <CtaBlock
        h2={industry.cta}
        body="We will use your request to show the context Kandryn identifies, the change it proposes, and what your reviewers would inspect before deciding."
        primary={{
          label: 'Request a walkthrough',
          href: `/contact?topic=${encodeURIComponent(industry.label)}`,
        }}
        secondary={{ label: 'See the pilot guide', href: '/pilot-guide' }}
      />
    </>
  );
}
