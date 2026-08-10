'use client';

import { useState } from 'react';

export default function ContactView() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [stack, setStack] = useState('');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (type: 'request-access' | 'walkthrough') => {
    setBusy(true);
    try {
      await fetch('/api/contact', {
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
    } catch {
      /* best-effort on the static site */
    } finally {
      setBusy(false);
      setSent(true);
    }
  };

  const reset = () => {
    setName('');
    setEmail('');
    setStack('');
    setMessage('');
    setSent(false);
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
        <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-0.02em' }}>Request received.</div>
        <p style={{ fontSize: 15, lineHeight: 1.55, color: 'var(--color-accent-800)', marginTop: 12 }}>
          We&apos;ll write back within a business day with a time and a short checklist of what to have ready.
        </p>
        <button className="btn btn-secondary" style={{ marginTop: 20 }} onClick={reset}>Send another</button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 520 }}>
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
