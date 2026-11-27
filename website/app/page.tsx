import Link from 'next/link';
import { Section, LinkGrid, CtaBlock, LinkRow } from '@/components/marketing/ui';
import HeroArt from '@/components/marketing/HeroArt';
import ClaimsExample from '@/components/marketing/ClaimsExample';
import { INDUSTRY_LINKS } from '@/lib/nav';

/**
 * The homepage, in the order the brief sets out.
 *
 * Five sections after the hero, each answering the next question: what
 * changes when a rule is brought in, how that context is built and kept,
 * where it applies, who decides, and what to do about it.
 *
 * The example sits immediately below the hero so the opening stays quiet.
 * The hero itself carries one headline, one paragraph and two actions.
 */

const CONTEXT_BLOCKS = [
  {
    h: 'Find the rule.',
    body:
      'Follow the work item to its parent initiative and identify relevant requirements, project documents, and code.',
  },
  {
    h: 'Build the context for this change.',
    body:
      'Bring the acceptance criteria and supporting material together. Use the work item’s acceptance criteria to resolve differences with background documents.',
  },
  {
    h: 'Keep up with the project.',
    body:
      'Refresh the repository index as commits land and select relevant context for each run. Reviewers can inspect the recorded references behind the proposal.',
  },
];

export default function HomePage() {
  return (
    <>
      <section className="hero-wrap">
        <HeroArt />
        <div className="container">
          <div className="hero-grid-2">
            <div>
              <h1 className="hero-h1">Deliver business improvements sooner.</h1>
              <p className="hero-lead">
                Kandryn identifies the business rules behind a software request and connects them to your requirements
                and existing code. Your engineers get a proposed change to review, and your business team can see how
                it reflects the way you work.
              </p>
              <div className="hero-actions">
                <Link className="btn btn-primary" href="/contact">
                  Request a walkthrough
                </Link>
                <Link className="hero-textlink" href="/industries">
                  Explore your industry &rarr;
                </Link>
              </div>
            </div>
            <div />
          </div>
        </div>
      </section>

      <Section
        h2="See what business context changes."
        lead="A claims manager asks for a report showing how long each claim spent in review. The ticket sounds straightforward. One rule changes the answer."
      >
        <ClaimsExample />
      </Section>

      <Section
        quiet
        h2="How Kandryn builds and maintains business context."
        lead="The reason for a change often lives in more than one place. Kandryn brings the relevant pieces together so the team can review the request and the proposed implementation side by side."
      >
        <div className="cols-3" style={{ marginTop: 36 }}>
          {CONTEXT_BLOCKS.map((b) => (
            <div key={b.h}>
              <h3 className="h3">{b.h}</h3>
              <p className="body-2" style={{ marginTop: 10 }}>{b.body}</p>
            </div>
          ))}
        </div>
        <LinkRow links={[{ label: 'Explore business and domain context', href: '/platform/business-domain-context' }]} />
      </Section>

      <Section
        h2="Explore Kandryn in your industry."
        lead="A review period, an approval, or an effective date can mean something different in every organization. Choose your industry to see a request where that distinction changes the software."
      >
        <LinkGrid items={INDUSTRY_LINKS} />
      </Section>

      <Section quiet h2="Your team decides what ships.">
        <p className="lead-2">
          Kandryn prepares a proposed change in the repository connected to your project. Your engineers inspect the
          change, use their existing review process, and decide whether to merge. Business reviewers can use the
          original request and its acceptance criteria to judge whether the result matches their intent.
        </p>
        <LinkRow
          links={[
            { label: 'See how review works', href: '/platform/review-governance' },
            { label: 'Trust & Security', href: '/trust/' },
          ]}
        />
      </Section>

      <CtaBlock
        h2="Bring a request whose meaning depends on a rule written somewhere else."
        body="Choose one improvement your team wants to make. We will walk through the context behind it, the proposed change, and the decisions your reviewers would make."
        secondary={{ label: 'See the pilot guide', href: '/pilot-guide' }}
      />
    </>
  );
}
