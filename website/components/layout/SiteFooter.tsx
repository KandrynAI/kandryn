import Link from 'next/link';
import { SITE, FOOTER_COLS } from '@/lib/site';
import { Logo } from '@/components/Logo';

export default function SiteFooter() {
  return (
    <footer
      style={{
        background: 'var(--color-text)',
        color: 'var(--color-neutral-400)',
        padding: '48px 64px 32px',
      }}
    >
      <div
        className="stack-1"
        style={{
          display: 'grid',
          gridTemplateColumns: '1.4fr repeat(3, 1fr)',
          gap: 40,
          paddingBottom: 32,
          borderBottom: '1px solid var(--color-neutral-800)',
        }}
      >
        {/* Brand column */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Logo context="footer-dark" height={24} />
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.55, marginTop: 14, maxWidth: 320, color: 'var(--color-neutral-400)' }}>
            {SITE.tagline}
          </p>
        </div>

        {/* Link columns */}
        {FOOTER_COLS.map((col) => (
          <div key={col.title}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', color: 'var(--color-neutral-500)' }}>
              {col.title}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
              {col.links.map((l, i) => (
                <Link
                  key={`${l.label}-${i}`}
                  href={l.href}
                  className="footer-link"
                  style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-neutral-300)' }}
                >
                  {l.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          borderTop: '1px solid var(--color-neutral-800)',
          paddingTop: 20,
          marginTop: 0,
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          fontSize: 12,
          color: 'var(--color-neutral-500)',
        }}
      >
        <span>{SITE.domain}</span>
        <nav aria-label="Legal links" style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          <a href="/privacy/" className="legal-footer-link">Privacy</a>
          <span style={{ opacity: 0.5 }}> · </span>
          <a href="/terms/" className="legal-footer-link">Terms</a>
          <span style={{ opacity: 0.5 }}> · </span>
          <a href="/security/" className="legal-footer-link">Security</a>
          <span style={{ opacity: 0.5 }}> · </span>
          <a href="/trust/" className="legal-footer-link">Trust</a>
          <span style={{ opacity: 0.5 }}> · </span>
          <a href="/contact/" className="legal-footer-link">Contact</a>
        </nav>
      </div>
    </footer>
  );
}
