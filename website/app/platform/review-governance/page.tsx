import type { Metadata } from 'next';
import { PageHero, Section, CtaBlock, LinkRow } from '@/components/marketing/ui';

export const metadata: Metadata = {
  alternates: { canonical: '/platform/review-governance/' },
  title: 'Review & Governance',
  description:
    'Kandryn gives your team a proposed change, the context used to prepare it, and a place to review it in the repository you already govern. Your reviewers decide what merges.',
};

export default function ReviewGovernancePage() {
  return (
    <>
      <PageHero
        eyebrow="Platform"
        h1="See what informed a change and who decides what happens next."
        lead="Kandryn gives your team a proposed change, the context used to prepare it, and a place to review it in the repository you already govern."
      />

      <Section h2="Review the business decision.">
        <p className="lead-2">
          Compare the requested behavior and acceptance criteria with the proposed result. The acceptance criteria on
          the work item are what the run treats as governing, so they are also the right thing to review against. Where
          a background document and the criteria disagreed, the criteria won.
        </p>
      </Section>

      <Section quiet h2="Review the implementation.">
        <p className="lead-2">
          Inspect the selected proposal, repository branch, and pull request through the team&rsquo;s existing process.
          Kandryn commits to a branch of its own and opens a pull request. It does not write to your default branch.
        </p>
        <details className="disclose" style={{ marginTop: 24 }}>
          <summary>What the branch and pull request look like</summary>
          <div className="body-2">
            A committed change goes to a branch named for the work item, and the pull request carries the work item in
            its title. Re-committing the same work item moves that branch to the new commit, so keep unrelated work on
            a different branch.
          </div>
        </details>
      </Section>

      <Section h2="Understand the security check.">
        <p className="lead-2">
          The security scan runs on a committed change when someone asks for it. It is not automatic, so a run nobody
          follows up on has not been scanned. The result is posted to your repository as a status check.
        </p>
        <div className="panel panel-pad" style={{ marginTop: 24 }}>
          <h3 className="h3">When a check blocks a merge</h3>
          <p className="body-2" style={{ marginTop: 12 }}>
            A check blocks merging when you configure the corresponding branch rule or policy in your own repository.
            Until you require it, the check reports its findings and blocks nothing. That control stays with your team,
            not with Kandryn.
          </p>
        </div>
      </Section>

      <Section quiet h2="Know who approves release.">
        <p className="lead-2">
          A change reaches your repository when someone commits it. A run can be set to commit its top-ranked proposal
          automatically, and that setting is off unless someone turns it on. Either way the result is a pull request:
          Kandryn does not merge changes.
        </p>
        <div className="cols-2" style={{ marginTop: 28 }}>
          <div className="panel panel-pad">
            <h3 className="h3">Manual commit</h3>
            <p className="body-2" style={{ marginTop: 10 }}>
              The default. A person reviews the proposals on the run and presses commit on the one they choose.
            </p>
          </div>
          <div className="panel panel-pad">
            <h3 className="h3">Auto-commit</h3>
            <p className="body-2" style={{ marginTop: 10 }}>
              An option on a run, off unless enabled. The top-ranked proposal is committed to its branch and opened as
              a pull request for review. Merging still belongs to your team.
            </p>
          </div>
        </div>
        <LinkRow
          links={[
            { label: 'Trust & Security', href: '/trust/' },
            { label: 'How a run works, stage by stage', href: '/how-it-works' },
          ]}
        />
      </Section>

      <CtaBlock
        h2="See the review your team would actually do."
        body="We will walk through a proposed change, the context recorded behind it, and the decisions your engineers and business reviewers would each make."
        secondary={{ label: 'See the pilot guide', href: '/pilot-guide' }}
      />
    </>
  );
}
