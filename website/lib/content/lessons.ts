/**
 * Kandryn University: three lessons, each finishable on the website.
 *
 * Lesson text, an exercise, and a sample answer on every page. A lesson that
 * sends the reader somewhere else to do the exercise is a brochure for a
 * course, not a course.
 */

export interface Lesson {
  slug: string;
  n: number;
  title: string;
  audience: string;
  minutes: string;
  lesson: string;
  exercise: string;
  /** Plain text for lessons 1 and 2; lesson 3 renders its own scorecard. */
  sampleAnswer?: string;
  related?: { label: string; href: string }[];
  metaDescription: string;
}

export const LESSONS: Lesson[] = [
  {
    slug: 'choose-your-first-business-change',
    n: 1,
    title: 'Choose your first business change.',
    audience: 'Business sponsors, product owners, and analysts',
    minutes: '6 min',
    lesson:
      'Choose a request small enough for someone to review in one sitting. Identify who owns the operating rule, where that rule is written, and one example that makes the expected behavior unambiguous. A well-scoped request gives both the business reviewer and the engineer a clear decision.',
    exercise:
      'Write one sentence describing the change, identify its source, and supply one example with an expected result.',
    sampleAnswer:
      'Show claim review days. The source is the claims operations guide. Two days in review, three waiting, and one more in review should produce three review days.',
    related: [{ label: 'Property & Casualty Insurance', href: '/industries/property-casualty-insurance' }],
    metaDescription:
      'Lesson 1: how to scope a first business change so both a business reviewer and an engineer can reach a clear decision.',
  },
  {
    slug: 'take-a-request-from-context-to-code',
    n: 2,
    title: 'Take a request from context to code.',
    audience: 'Engineers and architects',
    minutes: '8 min',
    lesson:
      'Read the ticket and its acceptance criteria. Inspect the related initiative, the supplied rule, and the relevant repository context. Review the proposed implementation and identify the line of reasoning that connects the source rule to the result. Use the existing review process to decide whether the proposal is ready.',
    exercise: 'Identify the error in a calculation that subtracts claim-open date from today for every claim.',
    sampleAnswer:
      'It includes waiting periods. Accumulate time in review states and test that review resumes correctly after documents arrive.',
    related: [
      { label: 'How Kandryn works', href: '/how-it-works' },
      { label: 'Integrations', href: '/integrations' },
    ],
    metaDescription:
      'Lesson 2: trace a request from its source rule to the proposed implementation, and decide whether the proposal is ready.',
  },
  {
    slug: 'evaluate-a-governed-pilot',
    n: 3,
    title: 'Evaluate a governed pilot.',
    audience: 'Engineering leads, security reviewers, and business sponsors',
    minutes: '9 min',
    lesson:
      'Choose a baseline, record the effort required to clarify the request, and inspect the proposed result. Track which checks were performed, what corrections the reviewers requested, and whether the change met the agreed criteria. Record the final decision and its owner.',
    exercise:
      'Create a pilot scorecard with a baseline, time to a reviewable proposal, clarification effort, reviewer corrections, checks performed, and acceptance decision.',
    related: [{ label: 'Pilot Guide', href: '/pilot-guide' }],
    metaDescription:
      'Lesson 3: build a pilot scorecard so your team judges Kandryn against a baseline it agreed in advance.',
  },
];

export function lessonBySlug(slug: string): Lesson | undefined {
  return LESSONS.find((l) => l.slug === slug);
}
