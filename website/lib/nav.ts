/**
 * The navigation tree, in one place.
 *
 * The header menus, the mobile navigation, the footer and the sitemap all
 * read from here. Three copies of a route list is three chances for a menu
 * item to outlive the page it points at, and section 3 of the brief requires
 * that every visible menu item reaches finished content.
 */

export interface NavLink {
  label: string;
  href: string;
  /** Used only by the footer and the industries overview, never in the menu. */
  blurb?: string;
}

export interface NavGroup {
  title?: string;
  links: NavLink[];
}

export interface NavMenu {
  id: string;
  label: string;
  groups: NavGroup[];
  /** The bottom-left link under the panel, where the menu has one. */
  foot?: NavLink;
  /** 3 columns unless the content needs 4. */
  columns?: 3 | 4;
}

export const PLATFORM: NavMenu = {
  id: 'platform',
  label: 'Platform',
  columns: 4,
  groups: [
    { links: [{ label: 'Business & Domain Context', href: '/platform/business-domain-context' }] },
    { links: [{ label: 'How Kandryn Works', href: '/how-it-works' }] },
    { links: [{ label: 'Review & Governance', href: '/platform/review-governance' }] },
    { links: [{ label: 'Integrations', href: '/integrations' }] },
  ],
};

/**
 * The three Industries columns, exactly as the brief specifies them. The
 * grouping is the navigation's own: Government HHS and Health Insurance are
 * different programmes of work and must never collapse into one "health"
 * entry.
 */
export const INDUSTRIES: NavMenu = {
  id: 'industries',
  label: 'Industries',
  columns: 3,
  groups: [
    {
      title: 'Government',
      links: [
        { label: 'Health & Human Services (HHS)', href: '/industries/government/health-human-services' },
        { label: 'Public Safety', href: '/industries/government/public-safety' },
      ],
    },
    {
      title: 'Retail & Financial Services',
      links: [
        { label: 'Retail', href: '/industries/retail' },
        { label: 'Banking & Financial Services', href: '/industries/banking-financial-services' },
      ],
    },
    {
      title: 'Insurance',
      links: [
        { label: 'Property & Casualty (P&C) Insurance', href: '/industries/property-casualty-insurance' },
        { label: 'Health Insurance', href: '/industries/health-insurance' },
      ],
    },
  ],
  foot: { label: 'Explore all industries', href: '/industries' },
};

export const USE_CASES: NavMenu = {
  id: 'use-cases',
  label: 'Use Cases',
  columns: 4,
  groups: [
    { links: [{ label: 'Implement a Business Rule', href: '/use-cases/implement-a-business-rule' }] },
    { links: [{ label: 'Change an Operational Report', href: '/use-cases/change-an-operational-report' }] },
    { links: [{ label: 'Update a Workflow or Approval Queue', href: '/use-cases/update-a-workflow-or-approval-queue' }] },
    { links: [{ label: 'Review a Change Against Requirements', href: '/use-cases/review-a-change-against-requirements' }] },
  ],
};

export const RESOURCES: NavMenu = {
  id: 'resources',
  label: 'Resources',
  columns: 3,
  groups: [
    {
      title: 'Learn',
      links: [
        { label: 'Kandryn University', href: '/university' },
        { label: 'Quickstart', href: '/resources#quickstart' },
      ],
    },
    {
      title: 'Evaluate',
      links: [
        { label: 'Pilot Guide', href: '/pilot-guide' },
        { label: 'FAQ', href: '/faq' },
      ],
    },
    {
      title: 'Updates',
      links: [{ label: 'Changelog', href: '/resources#changelog' }],
    },
  ],
};

export const MENUS: NavMenu[] = [PLATFORM, INDUSTRIES, USE_CASES, RESOURCES];

/** Items that are plain links in the header, after the menus. */
export const HEADER_LINKS: NavLink[] = [{ label: 'Trust & Security', href: '/trust/' }];

/** Every industry, in menu order, with the one-line description the overview
 *  and the homepage section use. The menu itself stays label-only. */
export const INDUSTRY_LINKS: NavLink[] = [
  {
    label: 'Health & Human Services (HHS)',
    href: '/industries/government/health-human-services',
    blurb: 'Referrals, eligibility, authorizations, and the event a wait is measured from.',
  },
  {
    label: 'Public Safety',
    href: '/industries/government/public-safety',
    blurb: 'Drafts, submissions, returns and approvals, and whose queue holds the next action.',
  },
  {
    label: 'Retail',
    href: '/industries/retail',
    blurb: 'Promotions, partial returns, and refund amounts that agree across channels.',
  },
  {
    label: 'Banking & Financial Services',
    href: '/industries/banking-financial-services',
    blurb: 'Documented exceptions and second approvals, kept apart from applications awaiting documents.',
  },
  {
    label: 'Property & Casualty (P&C) Insurance',
    href: '/industries/property-casualty-insurance',
    blurb: 'Claims that stay open while the review clock is paused.',
  },
  {
    label: 'Health Insurance',
    href: '/industries/health-insurance',
    blurb: 'Plan versions, service dates and receipt dates, and which configuration a reviewer sees.',
  },
];

export const USE_CASE_LINKS: NavLink[] = [
  {
    label: 'Implement a Business Rule',
    href: '/use-cases/implement-a-business-rule',
    blurb: 'Turn a documented rule into a change with an example reviewers can check.',
  },
  {
    label: 'Change an Operational Report',
    href: '/use-cases/change-an-operational-report',
    blurb: 'Build a report around the measure the team actually uses.',
  },
  {
    label: 'Update a Workflow or Approval Queue',
    href: '/use-cases/update-a-workflow-or-approval-queue',
    blurb: 'Route work the way the written procedure says it moves.',
  },
  {
    label: 'Review a Change Against Requirements',
    href: '/use-cases/review-a-change-against-requirements',
    blurb: 'Give business and engineering reviewers the same acceptance example.',
  },
];
