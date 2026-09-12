'use client';

import { useState } from 'react';
import { SITE } from '../lib/site';

export default function ContactView() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [stack, setStack] = useState('');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  /**
   * This used to set `sent` in a `finally`, so a network error or a 500 both
   * showed "Request received" and the request was silently dropped. On the page
   * whose entire job is capturing them, that is the worst possible failure
   * mode: the prospect believes they have been in touch and nobody has heard
   * from them. Success is now conditional on the response, and a failure says
   * so and offers a route that does not depend on the API being up.
   */
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
          message: message.trim() || undefined,
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
      <div className="field">
        <label htmlFor="c-msg">What would you point it at first?</label>
        <textarea id="c-msg" className="input" rows={5} style={{ resize: 'none' }} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="A refunds epic that's been open since March." />
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" disabled={busy} onClick={() => submit('request-access')}>Request access</button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => submit('walkthrough')}>Book a walkthrough</button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--color-neutral-700)' }}>
        We only use this to reply. Nothing is added to a marketing list.
      </p>
    </div>
  );
}
