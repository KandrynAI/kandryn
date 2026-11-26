'use client';

import Btn from '@/components/ui/Btn';
import TypeOnce from '@/components/home/TypeOnce';
import { HERO, HERO_PREVIEW, HERO_VARIANT } from '@/lib/home';

/**
 * The hero.
 *
 * One headline, one supporting paragraph, two buttons, and a card showing the
 * shape of the problem. The supporting copy is always visible: no accordion,
 * no tab, no carousel. It is the sentence a sponsor has to be able to repeat.
 *
 * Two motion treatments exist. `headline` types the h1; `snippet` leaves the
 * h1 static and renders the preview card beside it. Either way the buttons
 * render and work on the first frame. The animation is a layer on top, never
 * a gate.
 */
export default function HeroSection({ variant = HERO_VARIANT }: { variant?: 'headline' | 'snippet' }) {
  const typingHeadline = variant === 'headline';

  return (
    <section
      className="pad-x hero"
      style={{ padding: '72px 64px 64px', borderBottom: '2px solid var(--color-divider)' }}
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
              maxWidth: '14ch',
            }}
          >
            {typingHeadline ? <TypeOnce text={HERO.headline} durationMs={1400} /> : HERO.headline}
          </h1>

          <p
            style={{
              marginTop: 22,
              maxWidth: 520,
              fontSize: 17,
              lineHeight: 1.6,
              color: 'var(--color-neutral-800)',
              textWrap: 'pretty',
            }}
          >
            {HERO.supporting}
          </p>

          <div style={{ display: 'flex', gap: 12, marginTop: 30, flexWrap: 'wrap' }}>
            <Btn variant="primary" href={HERO.primary.href}>
              {HERO.primary.label}
            </Btn>
            <Btn variant="secondary" href={HERO.secondary.href}>
              {HERO.secondary.label}
            </Btn>
          </div>
        </div>

        {variant === 'snippet' && <HeroPreview />}
      </div>
    </section>
  );
}

/**
 * The preview card.
 *
 * It replaced a typed code diff, which showed the output to someone who
 * already knew what they were looking at. Three rows in the order the work
 * happens: what was asked, what was found written down somewhere else, and
 * what that means for the change.
 *
 * Plain words, no code. An engineer scrolling past loses nothing: the diff,
 * the proposals and the pull request are all in the sample below.
 */
function HeroPreview() {
  return (
    <figure className="hero-figure" style={{ margin: 0, minWidth: 0 }}>
      <div style={{ border: '2px solid var(--color-divider)', background: 'var(--color-bg)' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '8px 14px',
            borderBottom: '2px solid var(--color-divider)',
            background: 'var(--color-neutral-200)',
            fontSize: 12,
            color: 'var(--color-neutral-700)',
          }}
        >
          <span style={{ fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            {HERO_PREVIEW.label}
          </span>
          <span className="tag tag-outline">{HERO_PREVIEW.tag}</span>
        </div>

        <dl style={{ margin: 0, padding: '4px 0' }}>
          {HERO_PREVIEW.rows.map((row) => (
            <div
              key={row.k}
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid var(--color-divider)',
              }}
            >
              <dt
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--color-accent-700)',
                }}
              >
                {row.k}
              </dt>
              <dd style={{ margin: '5px 0 0', fontSize: 15, lineHeight: 1.5, color: 'var(--color-text)' }}>
                {row.v}
              </dd>
            </div>
          ))}
        </dl>

        {/* The worked number. Two readings of one claim, side by side: the
            whole argument for carrying the rule into the change, in two
            figures a claims lead can check in their head. */}
        <div
          style={{
            padding: '12px 16px',
            background: 'var(--color-neutral-100)',
            borderBottom: '1px solid var(--color-divider)',
          }}
        >
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--color-neutral-800)' }}>
            {HERO_PREVIEW.worked.lead}
          </p>
          <div style={{ display: 'flex', gap: 28, marginTop: 10 }}>
            {[HERO_PREVIEW.worked.without, HERO_PREVIEW.worked.with].map((side, i) => (
              <div key={side.label}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.07em',
                    textTransform: 'uppercase',
                    color: 'var(--color-neutral-700)',
                  }}
                >
                  {side.label}
                </div>
                <div
                  style={{
                    marginTop: 3,
                    fontSize: 20,
                    fontWeight: 700,
                    letterSpacing: '-0.01em',
                    // The right-hand figure is the one the rule produces, so it
                    // carries the accent. The other stays neutral rather than
                    // red: it is not an error, it is the answer without context.
                    color: i === 1 ? 'var(--color-accent-700)' : 'var(--color-neutral-800)',
                  }}
                >
                  {side.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: '11px 16px' }}>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--color-neutral-700)' }}>
            {HERO_PREVIEW.source}
          </p>
          <a
            href={HERO_PREVIEW.link.href}
            style={{
              display: 'inline-block',
              marginTop: 9,
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--color-accent-700)',
            }}
          >
            {HERO_PREVIEW.link.label}
          </a>
        </div>
      </div>
    </figure>
  );
}
