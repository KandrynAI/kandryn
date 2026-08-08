import type { Metadata } from 'next';
import ContactView from '@/components/ContactView';

export const metadata: Metadata = {
  title: 'Contact',
  description: "Bring one project. We'll wire it up with you — one real work item, run end to end, on a shared call.",
};

const FACTS: [string, string][] = [
  ['Typical reply', 'Within one business day, with a time and a short checklist.'],
  ["You'll need", 'A tracker project, a repository, and one model key.'],
  ['Optional for the full pipeline', 'Confluence or Notion credentials, for Narratia runbook push to your docs.'],
  ['Prefer to talk first?', 'Book a walkthrough and we’ll screen-share the loop on a real ticket.'],
];

export default function ContactPage() {
  return (
    <div className="stack-1" style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', borderBottom: '2px solid var(--color-divider)' }}>
      {/* LEFT */}
      <div className="pad-x" style={{ padding: 64, borderRight: '2px solid var(--color-divider)' }}>
        <div className="kicker" style={{ marginBottom: 20 }}>Request access</div>
        <h1 className="h1-inner" style={{ fontSize: 56, fontWeight: 900, letterSpacing: '-0.035em', lineHeight: 0.98 }}>
          Bring one project.
          <br />
          We&apos;ll wire it up with you.
        </h1>
        <p style={{ fontSize: 17, lineHeight: 1.55, color: 'var(--color-neutral-800)', marginTop: 22, maxWidth: 560 }}>
          Onboarding is a shared call: we connect your tracker and repository, run one real work item through the full
          pipeline — code generation, security scan, and runbook — and you keep whatever it produces.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 36 }}>
          {FACTS.map(([lead, body]) => (
            <p key={lead} style={{ fontSize: 15, color: 'var(--color-neutral-800)', borderTop: '1px solid var(--color-neutral-300)', paddingTop: 12 }}>
              <strong style={{ fontWeight: 800, color: 'var(--color-text)' }}>{lead}.</strong> {body}
            </p>
          ))}
        </div>
      </div>

      {/* RIGHT */}
      <div className="pad-x" style={{ padding: 64 }}>
        <ContactView />
      </div>
    </div>
  );
}
