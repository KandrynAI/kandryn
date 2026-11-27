import type { ReactNode } from 'react';
import { CaseTimeline, PlanVersionPick, ReceiptCalc, RecordsTable, ReviewClock } from '@/components/marketing/visuals';

/**
 * The six industry pages, as content.
 *
 * One record per page. The page template is shared; everything that makes a
 * page worth reading is here and individually editable, including the
 * artifact, which differs by industry because the shape of the
 * misunderstanding differs by industry.
 *
 * Every scenario is invented. No carrier, agency, retailer, bank or plan
 * named here exists, and none of these rules is an industry standard, a
 * regulation, or advice. They are examples of the KIND of rule that decides
 * what software should do.
 */

export interface Industry {
  /** The URL after /industries/. */
  slug: string;
  /** Menu and card label. */
  label: string;
  /** Short title for metadata and breadcrumbs. */
  short: string;
  h1: string;
  lead: string;
  exampleHeading: string;
  /** The narrative, as the brief wrote it. */
  example: string;
  rows: [string, string][];
  result?: string;
  visual: ReactNode;
  businessReview: string;
  engineeringReview: string;
  cta: string;
  /** What the browser tab and share cards say. */
  metaTitle: string;
  metaDescription: string;
}

export const INDUSTRIES: Industry[] = [
  {
    slug: 'government/health-human-services',
    label: 'Health & Human Services (HHS)',
    short: 'Government HHS',
    h1: 'Carry program rules into the systems that coordinate services.',
    lead: 'Program teams manage referrals, eligibility decisions, authorizations, and service delivery. A request to report on people waiting for service depends on which event the program uses to start the clock.',
    exampleHeading: 'When does the wait for service begin?',
    example:
      'In this illustrative program, a referral arrives on May 1, eligibility is confirmed on May 4, services are authorized on May 6, and the first service occurs on May 10. The program guide measures the wait from authorization. The report should show four elapsed days.',
    rows: [
      ['Request', 'Report on people waiting for service.'],
      ['Source', 'Sample program guide'],
      ['Operating rule', 'Measure the wait from authorization, not from referral.'],
    ],
    result: 'Four elapsed days, from authorization on May 6 to first service on May 10.',
    visual: (
      <CaseTimeline
        caption="Two of the four events decide the measure. Starting at referral would report nine days for the same case."
        events={[
          { date: 'May 1', label: 'Referral received' },
          { date: 'May 4', label: 'Eligibility confirmed' },
          { date: 'May 6', label: 'Services authorized', counts: true },
          { date: 'May 10', label: 'First service delivered', counts: true },
        ]}
      />
    ),
    businessReview:
      'A program manager checks that the measure starts at authorization and represents the population the program intends to report.',
    engineeringReview:
      'An engineer traces the calculation to the authorization and first-service events and checks how the report represents a case still waiting for service.',
    cta: 'Bring a program reporting rule to a walkthrough.',
    metaTitle: 'Government Health & Human Services',
    metaDescription:
      'How Kandryn carries program rules, such as the event a wait for service is measured from, into the systems that coordinate referrals, eligibility and authorizations.',
  },
  {
    slug: 'government/public-safety',
    label: 'Public Safety',
    short: 'Public Safety',
    h1: 'Carry agency reporting procedures into records-system changes.',
    lead: 'Records and supervisory teams depend on clear distinctions between a draft, a submitted report, a returned report, and an approved record. Those distinctions determine whose queue contains the next action.',
    exampleHeading: 'Which reports are ready for supervisory review?',
    example:
      'A records supervisor asks for a list of reports awaiting approval. Under the sample agency procedure, a submitted report enters supervisory review. A report returned for correction stays with its author until resubmitted. Two reports tied to the same incident can belong in different queues.',
    rows: [
      ['Request', 'List the reports awaiting supervisory approval.'],
      ['Source', 'Sample agency reporting procedure'],
      ['Operating rule', 'A returned report stays with its author until it is resubmitted.'],
    ],
    result: 'One of the two reports on this incident belongs in the supervisory queue.',
    visual: (
      <RecordsTable
        columns={['Report', 'Incident', 'Status', 'Owner', 'Next action']}
        caption="Both reports belong to one incident. Only the submitted one is waiting on a supervisor."
        rows={[
          { cells: ['RPT-4417', 'INC-2210', 'Submitted', 'Supervisor', 'Supervisory review'], highlight: true },
          { cells: ['RPT-4418', 'INC-2210', 'Returned for correction', 'Author', 'Author revises'] },
        ]}
      />
    ),
    businessReview: 'A records supervisor checks that each queue gives the right person the next action.',
    engineeringReview:
      'An engineer checks the report-level status, the return and resubmission transitions, and a test covering two reports associated with one incident.',
    cta: 'Bring one records workflow your agency wants to improve.',
    metaTitle: 'Public Safety',
    metaDescription:
      'How Kandryn carries agency reporting procedures, such as the difference between a submitted and a returned report, into records-system changes.',
  },
  {
    slug: 'retail',
    label: 'Retail',
    short: 'Retail',
    h1: 'Turn retail policies into consistent software behavior.',
    lead: 'A promotion can affect a sale, a partial return, and the amount a customer receives back. Store and digital teams need those policies to produce consistent results across channels.',
    exampleHeading: 'What should a customer receive for one returned bundle item?',
    example:
      'A customer returns one item from a promotional bundle. Its original price was $50, and the retailer allocated $10 of the bundle discount to that item. The sample policy refunds the amount paid for the returned item. The expected refund is $40.',
    rows: [
      ['Request', 'Refund a single item returned from a promotional bundle.'],
      ['Source', 'Sample returns and promotions policy'],
      ['Operating rule', 'Refund the amount paid, after the discount allocated to that item.'],
    ],
    visual: (
      <ReceiptCalc
        caption="Refunding the list price would return $50 and give back more than the customer paid."
        lines={[
          { label: 'Original item price', value: '$50.00' },
          { label: 'Bundle discount allocated to this item', value: '-$10.00' },
        ]}
        total={{ label: 'Expected refund', value: '$40.00' }}
      />
    ),
    businessReview: 'A merchandising or returns lead confirms that the calculation follows the promotion’s allocation policy.',
    engineeringReview:
      'An engineer checks that the refund uses the original transaction allocation and tests a partial return across the supported channels.',
    cta: 'Bring a policy your store and digital teams need to apply consistently.',
    metaTitle: 'Retail',
    metaDescription:
      'How Kandryn turns retail policies, such as how a bundle discount is allocated on a partial return, into consistent software behavior across channels.',
  },
  {
    slug: 'banking-financial-services',
    label: 'Banking & Financial Services',
    short: 'Banking & Financial Services',
    h1: 'Bring approval policies and exception rules into financial workflows.',
    lead: 'Pending applications can require different actions. Lending operations teams need software that distinguishes a documented policy exception from an application waiting for information.',
    exampleHeading: 'Which applications need a second approval?',
    example:
      'The sample bank routes a documented policy exception to a second approver. An application with missing income documentation goes to document follow-up. Both applications are pending. Only the first belongs in the second-approval queue.',
    rows: [
      ['Request', 'Show the applications that need a second approval.'],
      ['Source', 'Sample credit policy and exception schedule'],
      ['Operating rule', 'A documented policy exception needs a second approver. A missing document does not.'],
    ],
    result: 'Both applications are pending. One belongs in the second-approval queue.',
    visual: (
      <RecordsTable
        columns={['Application', 'Reason pending', 'Next destination']}
        caption='Filtering on the status alone puts both rows in one queue, because both read as "pending".'
        rows={[
          { cells: ['APP-10842', 'Documented policy exception', 'Second approval'], highlight: true },
          { cells: ['APP-10907', 'Income documentation outstanding', 'Document follow-up'] },
        ]}
      />
    ),
    businessReview: 'A lending operations lead checks whether the right team receives each case.',
    engineeringReview:
      'An engineer traces the queue filter to the documented exception category and workflow state, then verifies both routing outcomes.',
    cta: 'Bring a financial workflow exception to a walkthrough.',
    metaTitle: 'Banking & Financial Services',
    metaDescription:
      'How Kandryn brings approval policies and documented exception rules into lending workflows, so a second-approval queue holds the right applications.',
  },
  {
    slug: 'property-casualty-insurance',
    label: 'Property & Casualty (P&C) Insurance',
    short: 'Property & Casualty Insurance',
    h1: 'Make claims software reflect how your organization measures a claim.',
    lead: 'A claim can remain open while review is paused. When a carrier asks for time-in-review reporting, the operating definition of review determines which days count.',
    exampleHeading: 'Six elapsed days. Three review days.',
    example:
      'A claim spends two days in review, three days waiting for requested documents, and one more day in review. The fictional carrier pauses its review clock while those documents are outstanding. The expected result is three review days across six elapsed days.',
    rows: [
      ['Request', 'Show the number of days a claim spent in review.'],
      ['Source', 'Sample claims operations guide'],
      ['Operating rule', 'Pause the review clock while requested documents are outstanding.'],
    ],
    visual: (
      <ReviewClock
        caption="Subtracting the open date from today reports six. The rule in the operations guide reports three."
        segments={[
          { days: 2, label: 'In review', counts: true },
          { days: 3, label: 'Waiting for documents', counts: false },
          { days: 1, label: 'In review', counts: true },
        ]}
      />
    ),
    businessReview: 'A claims operations lead confirms the treatment of waiting periods.',
    engineeringReview:
      'An engineer verifies that the calculation accumulates review intervals, excludes waiting periods, and resumes when review restarts.',
    cta: 'Bring a claims reporting rule your team wants to change.',
    metaTitle: 'Property & Casualty Insurance',
    metaDescription:
      'How Kandryn makes claims software reflect the way a carrier measures review time, including a review clock that pauses while documents are outstanding.',
  },
  {
    slug: 'health-insurance',
    label: 'Health Insurance',
    short: 'Health Insurance',
    h1: 'Connect plan rules and effective dates to health insurance software changes.',
    lead: 'Benefits and claims teams work with plan versions, service dates, and receipt dates. Choosing the wrong date can lead a reviewer to the wrong configuration.',
    exampleHeading: 'Which plan version should the claims reviewer see?',
    example:
      'A service occurs on December 29, and the claim arrives on January 4. In this fictional plan, the service date determines the benefit configuration shown on the review screen. The expected result is the version in effect on December 29.',
    rows: [
      ['Request', 'Show the benefit configuration on the claim review screen.'],
      ['Source', 'Sample plan administration guide'],
      ['Operating rule', 'The service date determines which plan version applies, not the receipt date.'],
    ],
    result: 'The reviewer sees the version in effect on December 29.',
    visual: (
      <PlanVersionPick
        caption="Using the receipt date would show the January version and send the reviewer to the wrong configuration."
        dates={[
          { label: 'Date of service', value: 'December 29', drives: true },
          { label: 'Claim received', value: 'January 4' },
        ]}
        versions={[
          { label: 'Plan version 2025.2', range: 'Effective through December 31', selected: true },
          { label: 'Plan version 2026.1', range: 'Effective from January 1' },
        ]}
      />
    ),
    businessReview: 'A benefits operations lead checks that the displayed plan version follows the documented rule.',
    engineeringReview:
      'An engineer verifies the effective-date lookup and adds a year-boundary test covering a claim received after the plan version changes.',
    cta: 'Bring a plan rule or effective-date scenario to a walkthrough.',
    metaTitle: 'Health Insurance',
    metaDescription:
      'How Kandryn connects plan rules and effective dates to health insurance software, so a claim reviewer sees the plan version the documented rule selects.',
  },
];

export function industryBySlug(slug: string): Industry | undefined {
  return INDUSTRIES.find((i) => i.slug === slug);
}
