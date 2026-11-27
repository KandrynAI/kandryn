'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { MENUS, HEADER_LINKS } from '@/lib/nav';
import { SITE } from '@/lib/site';
import { Logo } from '@/components/Logo';

/**
 * The small-screen navigation.
 *
 * A full-height white panel rather than a dropdown, because four menus of
 * nested links do not fit under a header on a phone and a scrolling dropdown
 * leaves the page visible behind it, which reads as two surfaces at once.
 *
 * The call to action is a SIBLING of the scroll area, not an overlay pinned
 * to the bottom. Pinned, it covers the last link on a short screen, and the
 * last link is the one a reader scrolled all the way down to reach.
 */
export default function MobileNav({ onClose }: { onClose: () => void }) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Focus moves into the panel on open and returns to whatever opened it on
  // close, so a keyboard or screen-reader user is not dropped at the top of
  // the document.
  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      returnTo?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab' || !panelRef.current) return;
      // A simple focus loop. The panel covers the page, so letting Tab walk
      // out of it would move focus to links the reader cannot see.
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="mnav" id="mobile-nav" ref={panelRef} role="dialog" aria-modal="true" aria-label="Menu">
      <div className="container mnav-top">
        <Link href="/" aria-label="Kandryn home" onClick={onClose}>
          <Logo context="nav-light" height={22} />
        </Link>
        <button type="button" className="mnav-close" ref={closeRef} aria-label="Close menu" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M1 1l14 14M15 1L1 15" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="mnav-scroll">
        <div className="container">
          {MENUS.map((menu) => {
            const expanded = openGroup === menu.id;
            return (
              <div key={menu.id}>
                <button
                  type="button"
                  className="mnav-acc"
                  aria-expanded={expanded}
                  aria-controls={`mnav-${menu.id}`}
                  onClick={() => setOpenGroup(expanded ? null : menu.id)}
                >
                  {menu.label}
                  <svg
                    width="12" height="8" viewBox="0 0 12 8" aria-hidden="true"
                    style={{ transform: expanded ? 'rotate(180deg)' : undefined, flexShrink: 0 }}
                  >
                    <path d="M1 1l5 5 5-5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
                  </svg>
                </button>
                {expanded && (
                  <div className="mnav-panel" id={`mnav-${menu.id}`}>
                    {menu.groups.map((group, i) => (
                      <div key={group.title ?? i}>
                        {/* Every destination sits directly under its group
                            heading. No second level: six industries behind
                            two taps each is how a phone menu becomes a maze. */}
                        {group.title && <div className="mnav-grouptitle">{group.title}</div>}
                        {group.links.map((link) => (
                          <Link key={link.href} href={link.href} className="mnav-link" onClick={onClose}>
                            {link.label}
                          </Link>
                        ))}
                      </div>
                    ))}
                    {menu.foot && (
                      <Link
                        href={menu.foot.href}
                        className="mnav-link"
                        style={{ color: 'var(--color-accent)', fontWeight: 600 }}
                        onClick={onClose}
                      >
                        {menu.foot.label} &rarr;
                      </Link>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {HEADER_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="mnav-acc"
              style={{ display: 'block' }}
              onClick={onClose}
            >
              {l.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="mnav-foot">
        <div className="container" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Link className="btn btn-primary" href="/contact" onClick={onClose} style={{ width: '100%' }}>
            Request a walkthrough
          </Link>
          <a className="btn btn-secondary" href={`${SITE.appUrl}/sign-in`} style={{ width: '100%' }}>
            Sign in
          </a>
        </div>
      </div>
    </div>
  );
}
