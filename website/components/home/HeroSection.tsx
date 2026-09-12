'use client';

import Btn from '@/components/ui/Btn';
import TypeOnce from '@/components/home/TypeOnce';
import { HERO, HERO_SNIPPET, HERO_VARIANT } from '@/lib/home';

/**
 * The hero.
 *
 * One headline, one supporting line, two buttons. The restraint is the point:
 * a second paragraph here pushes the product preview below the fold, which is
 * the one thing the page cannot afford.
 *
 * Two motion treatments exist. `headline` types the h1; `snippet` leaves the
 * h1 static and types a short diff beneath it. Either way the buttons render
 * and work on the first frame — the animation is a layer on top, never a gate.
 */
export default function HeroSection({ variant = HERO_VARIANT }: { variant?: 'headline' | 'snippet' }) {
  const typingHeadline = variant === 'headline';

  return (
    <section
      className="pad-x hero"
      style={{ padding: '76px 64px 68px', borderBottom: '2px solid var(--color-divider)' }}
    >
      {/* Two columns while there is room for them: the words on the left, the
          thing the words describe on the right. Collapses to one below 1100px,
          where a side-by-side would squeeze both halves. */}
      <div className={variant === 'snippet' ? 'hero-grid' : undefined}>
        <div>
          <h1
            className="h1-home"
            aria-label={HERO.headline}
            style={{
              fontSize: typingHeadline ? 64 : 56,
              fontWeight: 700,
              letterSpacing: '-0.022em',
              lineHeight: 1.04,
              maxWidth: typingHeadline ? '15ch' : '13ch',
            }}
          >
            {typingHeadline ? <TypeOnce text={HERO.headline} durationMs={1400} /> : HERO.headline}
          </h1>

          <p
            style={{
              marginTop: 22,
              maxWidth: 470,
              fontSize: 17,
              lineHeight: 1.6,
              color: 'var(--color-neutral-800)',
              textWrap: 'pretty',
            }}
          >
            {HERO.supporting}
          </p>

          <div style={{ display: 'flex', gap: 12, marginTop: 32, flexWrap: 'wrap' }}>
            <Btn variant="primary" href={HERO.primary.href}>
              {HERO.primary.label}
            </Btn>
            <Btn variant="secondary" href={HERO.secondary.href}>
              {HERO.secondary.label}
            </Btn>
          </div>
        </div>

        {variant === 'snippet' && <HeroSnippet />}
      </div>
    </section>
  );
}

/**
 * The snippet variant's diff.
 *
 * Each line types in sequence, so the change reads as being written rather
 * than revealed. Only the two added lines animate — the context lines are
 * already there, which is what makes it read as a diff instead of a terminal.
 */
function HeroSnippet() {
  return (
    <figure className="hero-figure" style={{ margin: 0, minWidth: 0 }}>
      <div
        style={{
          border: '2px solid var(--color-divider)',
          background: 'var(--color-neutral-100)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '8px 14px',
            borderBottom: '2px solid var(--color-divider)',
            background: 'var(--color-neutral-200)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--color-neutral-700)',
          }}
        >
          <span>{HERO_SNIPPET.file}</span>
          <span className="tag tag-outline">PROPOSED</span>
        </div>
        <pre
          className="hero-snippet"
          style={{
            margin: 0,
            padding: '14px 0',
            overflowX: 'auto',
            fontSize: 13,
            lineHeight: 1.7,
          }}
        >
          {HERO_SNIPPET.lines.map((line, i) => {
            const added = line.op === '+';
            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  gap: 10,
                  padding: '0 14px',
                  background: added ? 'var(--color-accent-100)' : 'transparent',
                  whiteSpace: 'pre',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: '1ch',
                    color: added ? 'var(--color-accent-700)' : 'var(--color-neutral-400)',
                    fontWeight: added ? 700 : 400,
                  }}
                >
                  {line.op}
                </span>
                <span style={{ color: added ? 'var(--color-accent-800)' : 'var(--color-neutral-700)' }}>
                  {added ? (
                    // Staggered so the two added lines land in sequence. The
                    // whole sequence still finishes inside the budget.
                    <TypeOnce
                      text={line.text}
                      durationMs={520}
                      // Second added line starts as the first lands; the whole
                      // sequence is done by ~1.2s.
                      delayMs={i === 1 ? 180 : 640}
                      caret={i === 2}
                    />
                  ) : (
                    line.text || ' '
                  )}
                </span>
              </div>
            );
          })}
        </pre>
      </div>
      <figcaption style={{ marginTop: 10, fontSize: 12, color: 'var(--color-neutral-600)' }}>
        {HERO_SNIPPET.caption}
      </figcaption>
    </figure>
  );
}
