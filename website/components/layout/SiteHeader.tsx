'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS } from '@/lib/site';
import Btn from '@/components/ui/Btn';

export default function SiteHeader() {
  const pathname = usePathname() || '/';
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 20,
        background: 'var(--color-bg)',
        borderBottom: '2px solid var(--color-divider)',
        padding: '16px 32px',
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        overflowX: 'auto',
      }}
    >
      {/* LEFT — brand */}
      <Link
        href="/"
        style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, whiteSpace: 'nowrap' }}
        aria-label="Blue Mantis home"
      >
        <span className="bm-mark" style={{ width: 26, height: 26, color: 'var(--color-accent)' }} />
        <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--color-text)' }}>Blue Mantis</span>
      </Link>

      {/* CENTRE — nav */}
      <nav style={{ display: 'flex', gap: 2, flexShrink: 0, marginLeft: 8 }}>
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                fontSize: 14,
                fontWeight: active ? 700 : 500,
                padding: '10px 12px',
                whiteSpace: 'nowrap',
                background: active ? 'var(--color-accent-100)' : 'transparent',
                color: active ? 'var(--color-accent-700)' : 'var(--color-text)',
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* RIGHT */}
      <div style={{ display: 'flex', gap: 10, marginLeft: 'auto', flexShrink: 0 }}>
        <Btn variant="ghost" href="/app/sign-in">Sign in</Btn>
        <Btn variant="primary" href="/contact">Request access</Btn>
      </div>
    </header>
  );
}
