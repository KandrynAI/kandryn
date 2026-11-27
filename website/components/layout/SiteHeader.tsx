'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MENUS, HEADER_LINKS, type NavMenu } from '@/lib/nav';
import { SITE } from '@/lib/site';
import { Logo } from '@/components/Logo';
import MobileNav from '@/components/layout/MobileNav';

/**
 * The site header: a wordmark, four menus, two direct actions.
 *
 * Click to open, by default. Hover-to-open menus are a usability trap on a
 * site whose menus are the main way in: a pointer crossing the row on its way
 * to the hero opens and closes three panels, and a touch device has no hover
 * at all, so the same markup would need a second behaviour anyway.
 *
 * Every destination is a real anchor, so middle-click, copy-link and a
 * crawler all work whether or not the script that opens the panel ran.
 */
export default function SiteHeader() {
  const pathname = usePathname() || '/';
  const [openId, setOpenId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const headerRef = useRef<HTMLElement | null>(null);
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const close = useCallback((restoreFocusTo?: string) => {
    setOpenId((current) => {
      if (restoreFocusTo && current) triggerRefs.current[current]?.focus();
      return null;
    });
  }, []);

  // One menu at a time is the state shape, not a rule applied afterwards.
  const toggle = (id: string) => setOpenId((current) => (current === id ? null : id));

  // Escape closes and returns focus to the trigger that opened the panel,
  // or the keyboard user is dropped at the top of the document.
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close('restore');
      }
    };
    const onPointer = (e: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) setOpenId(null);
    };
    // Focus leaving the header entirely closes the panel, which is what a
    // Tab out of the last link should do.
    const onFocusIn = (e: FocusEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) setOpenId(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [openId, close]);

  // A navigation closes whatever was open. Without this the panel survives
  // the route change and covers the page the visitor just asked for.
  useEffect(() => {
    setOpenId(null);
    setMobileOpen(false);
  }, [pathname]);

  const isActive = (href: string) => {
    const base = href.split('#')[0].replace(/\/$/, '');
    return base !== '' && pathname.replace(/\/$/, '').startsWith(base);
  };

  return (
    <header className="hdr" ref={headerRef}>
      <div className="container">
        <div className="hdr-row">
          <Link href="/" className="hdr-brand" aria-label="Kandryn home">
            <Logo context="nav-light" height={24} />
          </Link>
          <span className="hdr-sep" aria-hidden="true" />

          <nav className="hdr-nav" aria-label="Main">
            {MENUS.map((menu) => (
              <button
                key={menu.id}
                type="button"
                className="hdr-trigger"
                aria-expanded={openId === menu.id}
                aria-haspopup="true"
                aria-controls={`menu-${menu.id}`}
                ref={(el) => {
                  triggerRefs.current[menu.id] = el;
                }}
                onClick={() => toggle(menu.id)}
              >
                {menu.label}
                <Chevron />
              </button>
            ))}
            {HEADER_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="hdr-link"
                style={isActive(l.href) ? { color: 'var(--color-accent)', fontWeight: 600 } : undefined}
              >
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="hdr-right">
            <a className="hdr-signin" href={`${SITE.appUrl}/sign-in`}>
              Sign in
            </a>
            <Link className="btn btn-primary" href="/contact">
              Request a walkthrough
            </Link>
          </div>

          <button
            type="button"
            className="hdr-burger"
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
          >
            <svg width="20" height="14" viewBox="0 0 20 14" aria-hidden="true">
              <path d="M0 1h20M0 7h20M0 13h20" stroke="currentColor" strokeWidth="1.8" fill="none" />
            </svg>
          </button>
        </div>
      </div>

      {MENUS.map((menu) =>
        openId === menu.id ? <MegaPanel key={menu.id} menu={menu} /> : null,
      )}

      {mobileOpen && <MobileNav onClose={() => setMobileOpen(false)} />}
    </header>
  );
}

function Chevron() {
  return (
    <svg className="hdr-chev" width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
      <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/**
 * One open panel.
 *
 * Absolutely positioned against the header, so it overlays the hero rather
 * than pushing it down: a menu that reflows the page moves the thing the
 * visitor was reading, and on a short laptop the hero's primary action
 * disappears below the fold while they are only browsing.
 */
function MegaPanel({ menu }: { menu: NavMenu }) {
  return (
    <div className="mega" id={`menu-${menu.id}`} role="group" aria-label={menu.label}>
      <div className="container">
        <div className="mega-inner">
          <div className={`mega-cols${menu.columns === 4 ? ' mega-cols-4' : ''}`}>
            {menu.groups.map((group, i) => (
              <div key={group.title ?? i}>
                {group.title && <div className="mega-group-title">{group.title}</div>}
                <div className="mega-list">
                  {group.links.map((link) => (
                    <Link key={link.href} href={link.href} className="mega-link">
                      {link.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {menu.foot && (
            <div className="mega-foot">
              <Link href={menu.foot.href} className="mega-all">
                {menu.foot.label} &rarr;
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
