import type { MetadataRoute } from 'next'
import { INDUSTRIES } from '@/lib/content/industries'
import { USE_CASES } from '@/lib/content/useCases'
import { LESSONS } from '@/lib/content/lessons'

// Required for Next.js `output: 'export'` — without it the sitemap route can't
// be statically emitted and the build fails (no sitemap.xml is produced).
export const dynamic = 'force-static'

const SITE_URL = 'https://kandryn.com'

/**
 * Trailing slashes, because next.config sets trailingSlash: true — these must
 * match the canonical each page declares or the two disagree about the URL.
 * /security is deliberately absent: it 308s to /trust/#boundaries, and a
 * sitemap should list destinations, not redirects.
 *
 * The industry, use-case and lesson entries are generated from the same data
 * the pages and the menus are, so a new page cannot be published without
 * appearing here.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  const page = (path: string, priority: number, changeFrequency: 'weekly' | 'monthly' | 'yearly') => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  })

  return [
    page('/', 1.0, 'weekly'),
    page('/platform/business-domain-context/', 0.9, 'monthly'),
    page('/how-it-works/', 0.9, 'monthly'),
    page('/platform/review-governance/', 0.9, 'monthly'),
    page('/integrations/', 0.8, 'monthly'),
    page('/industries/', 0.9, 'monthly'),
    ...INDUSTRIES.map((i) => page(`/industries/${i.slug}/`, 0.8, 'monthly')),
    ...USE_CASES.map((u) => page(`/use-cases/${u.slug}/`, 0.8, 'monthly')),
    page('/university/', 0.8, 'monthly'),
    ...LESSONS.map((l) => page(`/university/${l.slug}/`, 0.7, 'monthly')),
    page('/pilot-guide/', 0.8, 'monthly'),
    page('/trust/', 0.8, 'monthly'),
    page('/resources/', 0.7, 'weekly'),
    page('/faq/', 0.7, 'monthly'),
    page('/company/', 0.6, 'yearly'),
    page('/contact/', 0.6, 'yearly'),
    page('/pilot/', 0.6, 'yearly'),
    page('/privacy/', 0.5, 'yearly'),
    page('/terms/', 0.5, 'yearly'),
  ]
}
