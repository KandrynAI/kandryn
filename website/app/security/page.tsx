import type { Metadata } from 'next';
import Link from 'next/link';

const TARGET = '/trust/#boundaries';

/**
 * /security → /trust
 *
 * Security and Trust were two governance pages that had already begun to
 * drift: Security's processor table was a strict subset of Trust's
 * sub-processor table, minus the region and compliance columns. Trust is now
 * the single canonical page, and Security's seven boundary statements moved
 * there as the "Boundaries" section.
 *
 * The real redirect is a 308 in website/vercel.json, which Vercel applies
 * before filesystem routing — in production nobody reaches this page. It
 * lives in vercel.json rather than next.config because `redirects()` is
 * unsupported under `output: 'export'`.
 *
 * This page is the fallback for everywhere that config does not apply: local
 * preview, `npx serve out`, or any static host that is not Vercel. It carries
 * a meta refresh, a canonical tag, noindex, and a real link for anyone with
 * scripting blocked. Deleting it would break those; deleting the vercel.json
 * rule would fall back to it rather than 404.
 */
export const metadata: Metadata = {
  title: 'Security',
  description: 'Kandryn security controls now live on the Trust page.',
  alternates: { canonical: '/trust/' },
  robots: { index: false, follow: true },
  other: { refresh: `0; url=${TARGET}` },
};

export default function SecurityRedirectPage() {
  return (
    <section className="sec pad-x">
      <h1 className="h-display">Security has moved</h1>
      <p className="lead">
        Kandryn&apos;s security controls, data handling, sub-processors and boundary statements are now on one page
        rather than two.
      </p>
      <p style={{ marginTop: 24 }}>
        <Link href={TARGET} className="btn btn-primary">
          Continue to Trust &amp; Security
        </Link>
      </p>
    </section>
  );
}
