import type { Metadata } from 'next';
import { PageHero, Section, CtaBlock, LinkRow } from '@/components/marketing/ui';
import ProductPreview from '@/components/home/ProductPreview';
import { HOW_SECTIONS, LIMITS } from '@/lib/site';

export const metadata: Metadata = {
  alternates: { canonical: '/how-it-works/' },
  title: 'How Kandryn Works',
  description:
    'A business request becomes a change your team can review, in five steps. The eight stages of a run sit underneath, grouped by what runs every time and what waits for you to ask.',
};

/**
 * The five steps a sponsor can follow, with the eight verified stages
 * underneath them in expandable detail.
 *
 * The stage copy itself is unchanged: it was checked against the running
 * product and re-writing it for the redesign would put accuracy at the
 * mercy of layout. What changed is the order it is read in.
 */
const STEPS: { h: string; body: string; stages: string[] }[] = [
  {
    h: 'Select the work item and acceptance criteria.',
    body:
      'Point Kandryn at one scoped item on your board. Its acceptance criteria are what the run treats as governing, and what your reviewers judge the result against.',
    stages: ['01'],
  },
  {
    h: 'Assemble business and repository context.',
    body:
      'The run reads the parent story and initiative above the item, the repository files the change planner selects, and passages from documents your team uploaded. Where a background document and the acceptance criteria disagree, the criteria win.',
    stages: ['01'],
  },
  {
    h: 'Prepare and compare proposals where configured.',
    body:
      'Two generation agents attempt the same change independently, and a ranking agent scores them against each other. The second proposal depends on a second model key: with only one key saved, or if one agent fails, the run continues with a single candidate and records the failure.',
    stages: ['02', '03'],
  },
  {
    h: 'Choose a change and open a pull request.',
    body:
      'Committing a proposal writes it to a branch of its own and opens a pull request. A run can be set to commit its top-ranked proposal automatically; that setting is off unless someone turns it on. Kandryn never merges.',
    stages: ['04'],
  },
  {
    h: 'Review the result and run available post-commit checks.',
    body:
      'Review, security scanning and runbook generation are separate actions, each triggered by a person on a committed run. A run nobody follows up on has had none of them.',
    stages: ['05', '06', '07', '08'],
  },
];

const PHASE_LABEL: Record<string, string> = {
  run: 'Runs on every run',
  scheduled: 'Scheduling',
  ondemand: 'You trigger this',
};

export default function HowItWorksPage() {
  return (
    <>
      <PageHero
        eyebrow="Platform"
        h1="From a business request to a change your team can review."
        lead="Start with one scoped work item. Kandryn gathers relevant project context, prepares a proposed implementation, and carries the selected change into your existing review workflow."
      />

      <Section h2="The five steps">
        <p className="lead-2">
          Underneath these are eight discrete stages. Four run on every run, one covers scheduling, and three do
          nothing until somebody asks for them. If one fails, the run records which, and nothing half-finished reaches
          your repository.
        </p>
        <ol style={{ display: 'grid', gap: 20, marginTop: 34 }}>
          {STEPS.map((step, i) => {
            const stages = HOW_SECTIONS.filter((s) => step.stages.includes(s.n));
            return (
              <li key={step.h} className="panel panel-pad">
                <div style={{ display: 'grid', gridTemplateColumns: '46px minmax(0,1fr)', gap: 18 }}>
                  <span aria-hidden="true" style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-accent)', paddingTop: 3 }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <h3 className="h3">{step.h}</h3>
                    <p className="body-2" style={{ marginTop: 9 }}>{step.body}</p>

                    {stages.map((s) => (
                      <details className="disclose" key={s.n} style={{ marginTop: 14 }}>
                        <summary>
                          Stage {s.n}: {s.title}
                          {s.phase === 'ondemand' ? ' (you trigger this)' : ''}
                        </summary>
                        <div>
                          <p className="body-2">{s.body}</p>
                          <p
                            style={{
                              marginTop: 14,
                              fontSize: 11.5,
                              fontWeight: 700,
                              letterSpacing: '0.1em',
                              textTransform: 'uppercase',
                              color: 'var(--color-neutral-600)',
                            }}
                          >
                            {s.detailLabel} &middot; {PHASE_LABEL[s.phase] ?? s.phase}
                          </p>
                          <ul style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                            {s.details.map((d) => (
                              <li key={d} className="body-2" style={{ paddingLeft: 16, position: 'relative' }}>
                                <span aria-hidden="true" style={{ position: 'absolute', left: 0, color: 'var(--color-accent)' }}>
                                  &bull;
                                </span>
                                {d}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </details>
                    ))}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </Section>

      <Section quiet h2="What it will not do">
        <p className="lead-2">
          The boundaries are the product. Each of these is something you can check rather than something you have to
          take on trust.
        </p>
        <div className="cols-3" style={{ marginTop: 32 }}>
          {LIMITS.map((l) => (
            <div key={l.title} className="panel panel-pad">
              <h3 className="h3">{l.title}</h3>
              <p className="body-2" style={{ marginTop: 9 }}>{l.body}</p>
            </div>
          ))}
        </div>
        <LinkRow
          links={[
            { label: 'Review & Governance', href: '/platform/review-governance' },
            { label: 'Trust & Security', href: '/trust/' },
          ]}
        />
      </Section>

      {/* The deeper technical sample. A different scenario from the claims
          example on the homepage and the industry pages, on purpose: this one
          is a payments change with two ranked proposals, so a reader meets the
          ranking and the scores somewhere other than the business story. */}
      <Section
        h2="A deeper sample, end to end."
        lead="A different scenario from the claims example elsewhere on this site: one payments story, two ranked proposals, and the pull request a commit would open. Sample project, with illustrative scores."
      >
        <ProductPreview />
      </Section>

      <CtaBlock
        h2="Easier to watch than to read about."
        body="We will run a sample change end to end and answer questions as they come up. Nothing to prepare."
        secondary={{ label: 'See the pilot guide', href: '/pilot-guide' }}
      />
    </>
  );
}
