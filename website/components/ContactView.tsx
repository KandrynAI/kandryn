'use client';

import { useEffect, useState } from 'react';
import { SITE } from '../lib/site';

/**
 * The intent the visitor is expressing.
 *
 * It is NOT the API's `type`. That field is a closed enum of 'request-access'
 * and 'walkthrough' on a handler outside this project, so a third value is
 * rejected with a 400. A pilot therefore travels as a walkthrough carrying a
 * first line that says what it is, which the notification email shows in full.
 */
type Intent = 'walkthrough' | 'pilot';

const PILOT_PREFIX = 'Pilot on one work item.';

/**
 * The industry or use case the visitor arrived from.
 *
 * Carried as ?topic= on the links out of the industry and use-case pages, and
 * read here rather than through useSearchParams: this is a static export, so
 * that hook would need a Suspense boundary to buy nothing, and a visitor who
 * typed the URL by hand should get the same prefill either way.
 *
 * It is read ONCE, on mount, and only to prefill a field the visitor can see
 * and edit. Nothing from the query string is ever sent without appearing on
 * screen first, and the value is clipped so a long URL cannot stuff the
 * message body.
 */
const TOPIC_MAX = 80;

function topicFromLocation(): string {
  if (typeof window === 'undefined') return '';
  try {
    const raw = new URLSearchParams(window.location.search).get('topic') ?? '';
    return raw.replace(/\s+/g, ' ').trim().slice(0, TOPIC_MAX);
  } catch {
    return '';
  }
}

export default function ContactView({ defaultIntent = 'walkthrough' }: { defaultIntent?: Intent }) {
  const [intent, setIntent] = useState<Intent>(defaultIntent);
  const [topic, setTopic] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [stack, setStack] = useState('');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  // Prefill after hydration, so the exported HTML is identical for every
  // visitor and the field still fills in for the one who followed a link.
  useEffect(() => {
    setTopic(topicFromLocation());
  }, []);

  /**
   * This used to set `sent` in a `finally`, so a network error or a 500 both
   * showed "Request received" and the request was silently dropped. On the page
   * whose entire job is capturing them, that is the worst possible failure
   * mode: the prospect believes they have been in touch and nobody has heard
   * from them. Success is now conditional on the response, and a failure says
   * so and offers a route that does not depend on the API being up.
   */
  // The pilot says so in the message's first line, because the enum cannot
  // say it. An empty message still carries the intent.
  const withIntent = (body: string): string | undefined => {
    const lines: string[] = [];
    if (intent === 'pilot') lines.push(PILOT_PREFIX);
    const t = topic.trim();
    if (t) lines.push(`Interested in: ${t}`);
    if (body) lines.push(body);
    return lines.length ? lines.join('\n\n') : undefined;
  };

  const submit = async (type: 'request-access' | 'walkthrough') => {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`${SITE.apiBaseUrl}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          name: name.trim() || 'Unknown',
          email: email.trim(),
          company: stack.trim() || 'Not specified',
          message: withIntent(message.trim()),
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setSent(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setIntent(defaultIntent);
    setTopic(topicFromLocation());
    setName('');
    setEmail('');
    setStack('');
    setMessage('');
    setSent(false);
    setFailed(false);
  };

  if (sent) {
    return (
      <div
        style={{
          border: '2px solid var(--color-accent)',
          background: 'var(--color-accent-100)',
          padding: 28,
          maxWidth: 520,
          animation: 'bmrise 0.35s ease-out both',
        }}
      >
        <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.25, letterSpacing: '-0.008em' }}>Request received.</div>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--color-accent-800)', marginTop: 12 }}>
          We&apos;ll write back within a business day with a time and a short checklist of what to have ready.
        </p>
        <button className="btn btn-secondary" style={{ marginTop: 20 }} onClick={reset}>Send another</button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 520 }}>
      {failed && (
        <div role="alert" style={{ border: '2px solid #b23a2f', background: '#fdf2f1', padding: '16px 18px' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#b23a2f' }}>That did not send.</div>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--color-neutral-800)', marginTop: 8 }}>
            Your details are still in the form, so try again in a moment. If it keeps failing, email{' '}
            <a href={`mailto:${SITE.email}`} style={{ color: 'var(--color-accent)', fontWeight: 700 }}>
              {SITE.email}
            </a>{' '}
            and we will pick it up from there.
          </p>
        </div>
      )}
      <div className="field">
        <label htmlFor="c-name">Name</label>
        <input id="c-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Okafor" />
      </div>
      <div className="field">
        <label htmlFor="c-email">Work email</label>
        <input id="c-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ada@company.com" />
      </div>
      <div className="field">
        <label htmlFor="c-stack">Tracker and repository</label>
        <input id="c-stack" className="input" value={stack} onChange={(e) => setStack(e.target.value)} placeholder="Jira + GitHub" />
      </div>
      {/* Radios rather than a select: two options, both worth reading, and
          they are reachable and focus-visible without any styling of ours. */}
      <fieldset className="field" style={{ border: 'none', padding: 0, margin: 0 }}>
        <legend
          style={{
            padding: 0,
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--color-neutral-700)',
          }}
        >
          What are you asking for?
        </legend>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
          {([
            ['walkthrough', 'A walkthrough', 'We screen-share the loop on a real ticket. Nothing to prepare.'],
            ['pilot', 'A pilot on one work item', 'We run one of your own items end to end. You bring a project and credentials.'],
          ] as [Intent, string, string][]).map(([value, label, help]) => (
            <label
              key={value}
              htmlFor={`c-intent-${value}`}
              // .field label is uppercase and letter-spaced for the short
              // field captions above. Inherited here it shouts a whole
              // sentence of help text, so this one opts out.
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
                cursor: 'pointer',
                fontWeight: 400,
                textTransform: 'none',
                letterSpacing: 'normal',
                fontSize: 15,
                color: 'var(--color-text)',
              }}
            >
              <input
                id={`c-intent-${value}`}
                type="radio"
                name="c-intent"
                value={value}
                checked={intent === value}
                onChange={() => setIntent(value)}
                style={{ marginTop: 4 }}
              />
              <span>
                <span style={{ fontWeight: 600 }}>{label}</span>
                <span style={{ display: 'block', fontSize: 13, color: 'var(--color-neutral-700)', lineHeight: 1.5 }}>
                  {help}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {/* Visible and editable, never hidden. A prefilled field the visitor
          cannot see is a value sent on their behalf without their knowing. */}
      <div className="field">
        <label htmlFor="c-topic">Industry or use case</label>
        <input
          id="c-topic"
          className="input"
          value={topic}
          maxLength={TOPIC_MAX}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Property & Casualty Insurance"
        />
      </div>
      <div className="field">
        <label htmlFor="c-msg">What would you point it at first?</label>
        <textarea id="c-msg" className="input" rows={5} style={{ resize: 'none' }} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="A refunds epic that's been open since March." />
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {/* The intent the visitor picked above is the prominent action. It
            used to be "Request access", which on /pilot/ gave the page's own
            purpose the quieter button. */}
        <button className="btn btn-primary" disabled={busy} onClick={() => submit('walkthrough')}>
          {intent === 'pilot' ? 'Request a pilot' : 'Request a walkthrough'}
        </button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => submit('request-access')}>Request access</button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--color-neutral-700)' }}>
        We only use this to reply. Nothing is added to a marketing list.
      </p>
    </div>
  );
}
