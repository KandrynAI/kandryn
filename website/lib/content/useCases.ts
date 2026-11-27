/**
 * The four use-case pages.
 *
 * Short and task-shaped on purpose: each one is a trigger, the material
 * Kandryn uses, the output, an acceptance check, and a way through to the
 * industry page where the same scenario is worked in full. They are the
 * shortest route from "what would this do for us" to a concrete example.
 */

export interface UseCase {
  slug: string;
  label: string;
  h1: string;
  lead: string;
  body: string;
  /** What Kandryn reads for this kind of request. */
  material: string[];
  /** What the team gets back. */
  output: string[];
  acceptance: string;
  related: { label: string; href: string }[];
  metaTitle: string;
  metaDescription: string;
}

export const USE_CASES: UseCase[] = [
  {
    slug: 'implement-a-business-rule',
    label: 'Implement a Business Rule',
    h1: 'Turn a documented business rule into a reviewable software change.',
    lead: 'Start with the request, identify the source that defines the rule, and give reviewers a concrete example of the expected behavior.',
    body: 'A lending team asks for second approval on a defined class of exceptions. The relevant procedure identifies which cases qualify. Kandryn brings that rule together with the work item and repository context to prepare a proposed change. Operations checks the example. Engineering checks the implementation.',
    material: [
      'The work item and its acceptance criteria.',
      'The initiative or parent story that explains why the rule matters.',
      'Passages from the procedure your team uploaded, where one bears on the request.',
      'The repository files the change planner selects as relevant.',
    ],
    output: [
      'A proposed change on its own branch, opened as a pull request.',
      'The references the run recorded, so a reviewer can see what informed it.',
      'An example of the expected behavior both reviewers can check.',
    ],
    acceptance:
      'An application with a qualifying exception enters second approval. An application awaiting documents enters follow-up.',
    related: [{ label: 'Banking & Financial Services', href: '/industries/banking-financial-services' }],
    metaTitle: 'Implement a Business Rule',
    metaDescription:
      'Turn a documented business rule into a software change your team can review, with an acceptance example both business and engineering reviewers can check.',
  },
  {
    slug: 'change-an-operational-report',
    label: 'Change an Operational Report',
    h1: 'Build reports around the measure your team actually uses.',
    lead: 'A report can use the right data and still answer the wrong question. The definition of a measure determines the dates, statuses, and records that belong in it.',
    body: 'A program manager requests a service-wait report. The program guide identifies authorization as the starting event. Kandryn uses the work item and supplied definition to prepare a calculation reviewers can check against a dated example.',
    material: [
      'The work item and the measure it asks for.',
      'The definition your team supplied, in the guide or requirement that holds it.',
      'The repository files that build the existing report.',
    ],
    output: [
      'A proposed calculation, with the events it reads named.',
      'A dated example that makes the expected number unambiguous.',
      'A test that fails if the measure silently changes later.',
    ],
    acceptance: 'Authorization on May 6 and first service on May 10 produce four elapsed days.',
    related: [
      { label: 'Government Health & Human Services', href: '/industries/government/health-human-services' },
      { label: 'Property & Casualty Insurance', href: '/industries/property-casualty-insurance' },
    ],
    metaTitle: 'Change an Operational Report',
    metaDescription:
      'Build an operational report around the measure your team actually uses, with a dated example that makes the expected result unambiguous.',
  },
  {
    slug: 'update-a-workflow-or-approval-queue',
    label: 'Update a Workflow or Approval Queue',
    h1: 'Route work according to the procedure your team follows.',
    lead: 'The word "pending" rarely tells a team whose turn it is. The reason, the status transition, and the documented exception determine the next action.',
    body: 'A report returned for correction belongs with its author until resubmission. The proposed workflow change should reflect that handoff and preserve a clear path back to supervisory review.',
    material: [
      'The work item describing the routing the team wants.',
      'The procedure that defines each state and who owns it.',
      'The repository code that assigns work to a queue today.',
    ],
    output: [
      'A proposed change to the routing, with each transition named.',
      'A test for the round trip, not only the forward step.',
    ],
    acceptance: 'The returned report leaves the supervisory queue and re-enters it when the author resubmits.',
    related: [{ label: 'Government Public Safety', href: '/industries/government/public-safety' }],
    metaTitle: 'Update a Workflow or Approval Queue',
    metaDescription:
      'Route work the way your written procedure says it moves, including the handoff back to a reviewer after a correction.',
  },
  {
    slug: 'review-a-change-against-requirements',
    label: 'Review a Change Against Requirements',
    h1: 'Give business and engineering reviewers the same acceptance example.',
    lead: 'A proposed change is easier to evaluate when both reviewers can see the request, the governing rule, and a specific expected result.',
    body: 'For a partial promotional return, a business reviewer checks the refund policy and the expected amount. An engineer checks the calculation, the transaction fields, and the test. The shared example makes a disagreement visible before the team accepts the change.',
    material: [
      'The work item and its acceptance criteria, which govern where sources disagree.',
      'The policy passage the request depends on.',
      'The proposed change itself, in the repository.',
    ],
    output: [
      'One example both reviewers read the same way.',
      'The recorded references behind the proposal.',
      'A pull request in your own review process.',
    ],
    acceptance: 'An item priced at $50 with a $10 allocated discount produces a $40 refund under the sample policy.',
    related: [
      { label: 'Retail', href: '/industries/retail' },
      { label: 'Review & Governance', href: '/platform/review-governance' },
    ],
    metaTitle: 'Review a Change Against Requirements',
    metaDescription:
      'Give business and engineering reviewers the same acceptance example, so a disagreement about intent surfaces before the change is accepted.',
  },
];

export function useCaseBySlug(slug: string): UseCase | undefined {
  return USE_CASES.find((u) => u.slug === slug);
}
