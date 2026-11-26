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
const TITLE = 'Kandryn | Deliver business improvements sooner';
const DESC =
  'Kandryn builds and maintains the business context behind each software request. It brings together your requirements, business rules and existing code to prepare a change for review, and your team decides what merges.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: '%s | Kandryn' },
  description: DESC,
  applicationName: 'Kandryn',
  alternates: { canonical: '/' },
  openGraph: { type: 'website', siteName: 'Kandryn', title: TITLE, description: DESC, url: SITE_URL },
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
