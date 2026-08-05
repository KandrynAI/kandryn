import type { Metadata } from 'next';
import { Archivo, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import SiteHeader from '@/components/layout/SiteHeader';
import SiteFooter from '@/components/layout/SiteFooter';
import CtaBanner from '@/components/layout/CtaBanner';
import { JsonLd, organizationLd, softwareApplicationLd } from '@/lib/jsonld';
import { SITE } from '@/lib/site';

const archivo = Archivo({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  display: 'swap',
  variable: '--font-archivo',
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-mono',
});

const SITE_URL = `https://${SITE.domain}`;
const TITLE = 'Blue Mantis — the backlog writes the code back to you';
const DESC =
  'An AI delivery assistant that reads a work item, runs four agents against it — Raptia and Fovea generate, Synthesia ranks, Veria reviews — and opens the pull request. Run it now, or queue tonight and read the diffs in the morning.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: '%s | Blue Mantis' },
  description: DESC,
  applicationName: 'Blue Mantis',
  alternates: { canonical: '/' },
  openGraph: { type: 'website', siteName: 'Blue Mantis', title: TITLE, description: DESC, url: SITE_URL },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESC },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${jetbrainsMono.variable}`}>
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <div className="page">
          <SiteHeader />
          <main id="main">{children}</main>
          <CtaBanner />
          <SiteFooter />
        </div>
        <JsonLd data={organizationLd} />
        <JsonLd data={softwareApplicationLd} />
      </body>
    </html>
  );
}
