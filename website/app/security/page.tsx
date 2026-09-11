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
 * The route stays rather than being deleted, so nav links, footer links and
 * any inbound link still resolve. A static export cannot issue a 3xx —
 * `redirects()` in next.config is unsupported under `output: 'export'` — so
 * this is a meta refresh plus a canonical tag pointing at the target, with a
 * real link for anyone who lands here with scripting blocked.
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
