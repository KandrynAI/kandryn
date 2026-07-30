'use client';

import { useState } from 'react';
import { RESOURCES, QUICKSTART, CHANGELOG } from '@/lib/site';

const FILTERS = ['All', 'Guides', 'Patterns', 'Engineering', 'Templates'];

export default function ResourcesView() {
  const [active, setActive] = useState('All');
  const [email, setEmail] = useState('');
  const [subscribed, setSubscribed] = useState(false);

  const cards = active === 'All' ? RESOURCES : RESOURCES.filter((r) => r.cat === active);

  const subscribe = async () => {
    if (!email.trim()) return;
    setSubscribed(true);
    try {
      await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
    } catch {
      /* demo site — swallow */
    }
  };

  return (
    <>
      {/* Filter chips */}
      <div className="pad-x" style={{ display: 'flex', gap: 8, padding: '0 64px 28px', flexWrap: 'wrap' }}>
        {FILTERS.map((f) => {
          const on = active === f;
          return (
            <button
              key={f}
              onClick={() => setActive(f)}
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.06em',
                padding: '9px 14px',
                cursor: 'pointer',
                background: on ? 'var(--color-accent)' : 'transparent',
                color: on ? '#fff' : 'var(--color-neutral-800)',
                border: on ? '1px solid var(--color-accent)' : '1px solid var(--color-neutral-300)',
              }}
            >
              {f}
            </button>
          );
        })}
      </div>

      {/* Featured + quickstart */}
      <div
        className="stack-1"
        style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', borderTop: '2px solid var(--color-divider)', borderBottom: '2px solid var(--color-divider)' }}
      >
        <div className="pad-x" style={{ padding: '48px 64px', borderRight: '2px solid var(--color-divider)', background: 'var(--color-accent-100)' }}>
          <div className="kicker">Featured guide</div>
          <h2 style={{ fontSize: 40, fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1.02, marginTop: 14 }}>
            Writing acceptance criteria a model can actually implement
          </h2>
          <p style={{ fontSize: 16, lineHeight: 1.55, color: 'var(--color-neutral-800)', marginTop: 18, maxWidth: 560 }}>
            The difference between a ticket a run nails on the first pass and one it flails on is almost always the
            acceptance criteria. Here is the shape that works, with examples.
          </p>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 26, flexWrap: 'wrap' }}>
            <button className="btn btn-primary">Read the guide</button>
            <span style={{ fontSize: 13, color: 'var(--color-neutral-700)' }}>14 min · updated July 2026</span>
          </div>
        </div>

        <div className="pad-x" style={{ padding: '48px 64px' }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.12em', color: 'var(--color-neutral-600)' }}>START HERE</div>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 16 }}>
            {QUICKSTART.map((q) => (
              <div key={q.n} style={{ display: 'flex', gap: 16, alignItems: 'baseline', borderTop: '1px solid var(--color-neutral-300)', padding: '14px 0' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-neutral-600)', width: 28, flexShrink: 0 }}>{q.n}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{q.title}</div>
                  <div style={{ fontSize: 13, color: 'var(--color-neutral-700)', marginTop: 3 }}>{q.body}</div>
                </div>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-neutral-600)', flexShrink: 0 }}>{q.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Card grid */}
      <section className="pad-x" style={{ padding: '48px 64px 8px' }}>
        <h2 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 24 }}>
          {active === 'All' ? 'Everything' : active}
        </h2>
        <div
          className="grid-3 stack-1"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', borderTop: '2px solid var(--color-divider)', borderLeft: '2px solid var(--color-divider)' }}
        >
          {cards.map((c) => (
            <div
              key={c.title}
              className="resource-card"
              style={{
                borderRight: '2px solid var(--color-divider)',
                borderBottom: '2px solid var(--color-divider)',
                padding: 26,
                minHeight: 210,
                display: 'flex',
                flexDirection: 'column',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', color: 'var(--color-accent-700)' }}>{c.kind}</span>
                <span style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>{c.meta}</span>
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.015em', lineHeight: 1.15, marginTop: 14, textWrap: 'pretty' }}>{c.title}</div>
              <div style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--color-neutral-700)', marginTop: 10, textWrap: 'pretty' }}>{c.body}</div>
              <div style={{ marginTop: 'auto', paddingTop: 16, fontSize: 13, fontWeight: 700, color: 'var(--color-accent-700)' }}>{c.cta} →</div>
            </div>
          ))}
        </div>
      </section>

      {/* Changelog + newsletter */}
      <div
        className="stack-1"
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: '2px solid var(--color-divider)', borderBottom: '2px solid var(--color-divider)', marginTop: 40 }}
      >
        <div className="pad-x" style={{ padding: '48px 64px', borderRight: '2px solid var(--color-divider)' }}>
          <h2 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 20 }}>Changelog</h2>
          {CHANGELOG.map((c) => (
            <div key={c.date} style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 16, borderTop: '1px solid var(--color-neutral-300)', padding: '14px 0' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-neutral-600)' }}>{c.date}</span>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{c.title}</div>
                <div style={{ fontSize: 13, color: 'var(--color-neutral-700)', marginTop: 3 }}>{c.body}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="pad-x" style={{ padding: '48px 64px' }}>
          <h2 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 20 }}>Delivery notes, monthly</h2>
          <p style={{ fontSize: 15, lineHeight: 1.55, color: 'var(--color-neutral-800)', marginBottom: 22, maxWidth: 460 }}>
            One email a month: what shipped, what we learned from the runs that failed, and the patterns worth stealing.
          </p>
          {subscribed ? (
            <div style={{ border: '2px solid var(--color-accent)', background: 'var(--color-accent-100)', padding: 18, maxWidth: 420 }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>You&apos;re on the list.</div>
              <div style={{ fontSize: 13, color: 'var(--color-accent-800)', marginTop: 6 }}>The next delivery note lands at the start of the month.</div>
            </div>
          ) : (
            <div style={{ maxWidth: 420 }}>
              <div className="field">
                <label htmlFor="nl-email">Work email</label>
                <input id="nl-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ada@company.com" />
              </div>
              <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={subscribe}>Subscribe</button>
              <p style={{ fontSize: 12, color: 'var(--color-neutral-700)', marginTop: 12 }}>
                No product announcements dressed up as research. Unsubscribe in one click.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
