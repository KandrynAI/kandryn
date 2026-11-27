import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHero, Section, ReviewPair, CtaBlock, LinkRow, IllustrativeTag } from '@/components/marketing/ui';
import { USE_CASES, useCaseBySlug } from '@/lib/content/useCases';

type Params = { slug: string };

export function generateStaticParams(): Params[] {
  return USE_CASES.map((u) => ({ slug: u.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const uc = useCaseBySlug(slug);
  if (!uc) return {};
  return {
    alternates: { canonical: `/use-cases/${uc.slug}/` },
    title: uc.metaTitle,
    description: uc.metaDescription,
  };
}

export default async function UseCasePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const uc = useCaseBySlug(slug);
  if (!uc) notFound();

  return (
    <>
      <PageHero eyebrow="Use case" h1={uc.h1} lead={uc.lead} />

      <Section>
        <p className="lead-2" style={{ marginTop: 0 }}>{uc.body}</p>

        <div className="cols-2" style={{ marginTop: 34 }}>
          <div className="panel panel-pad">
            <h2 className="h3">What Kandryn reads</h2>
            <ul style={{ marginTop: 14, display: 'grid', gap: 10 }}>
              {uc.material.map((m) => (
                <li key={m} className="body-2" style={{ paddingLeft: 18, position: 'relative' }}>
                  <span aria-hidden="true" style={{ position: 'absolute', left: 0, color: 'var(--color-accent)' }}>
                    &bull;
                  </span>
                  {m}
                </li>
              ))}
            </ul>
          </div>
          <div className="panel panel-pad">
            <h2 className="h3">What your team gets back</h2>
            <ul style={{ marginTop: 14, display: 'grid', gap: 10 }}>
              {uc.output.map((m) => (
                <li key={m} className="body-2" style={{ paddingLeft: 18, position: 'relative' }}>
                  <span aria-hidden="true" style={{ position: 'absolute', left: 0, color: 'var(--color-accent)' }}>
                    &bull;
                  </span>
                  {m}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="panel-quiet panel-pad" style={{ marginTop: 30 }}>
          <IllustrativeTag />
          <h2 className="h3" style={{ marginTop: 10 }}>Acceptance check</h2>
          <p style={{ marginTop: 10, fontSize: 17, lineHeight: 1.5, color: 'var(--color-accent-700)', fontWeight: 600 }}>
            {uc.acceptance}
          </p>
        </div>

        <LinkRow links={uc.related} />
      </Section>

      <Section quiet h2="Who decides what ships">
        <p className="lead-2">
          Kandryn opens a pull request on its own branch and does not merge it. Your engineers use the review process
          they already have. Business reviewers use the original request and its acceptance criteria to judge whether
          the result matches their intent.
        </p>
        <ReviewPair
          business="Does the example match the way we actually work, and does it answer the request we made?"
          engineering="Does the implementation fit the repository, and does the test fail if the rule is changed by accident?"
        />
      </Section>

      <CtaBlock
        h2="Bring a request whose meaning depends on a rule written somewhere else."
        body="Choose one improvement your team wants to make. We will walk through the context behind it, the proposed change, and the decisions your reviewers would make."
        primary={{
          label: 'Request a walkthrough',
          href: `/contact?topic=${encodeURIComponent(uc.label)}`,
        }}
        secondary={{ label: 'See the pilot guide', href: '/pilot-guide' }}
      />
    </>
  );
}
