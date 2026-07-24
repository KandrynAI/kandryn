import type { MetadataRoute } from 'next'

// Required for Next.js `output: 'export'` — without it the robots route can't
// be statically emitted and the build fails (no robots.txt is produced).
export const dynamic = 'force-static'

const SITE_URL = 'https://getbluemantis.com'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/app/', '/api/'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
