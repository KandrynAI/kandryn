import type { Metadata } from 'next';
import ContactView from '@/components/ContactView';

export const metadata: Metadata = {
  alternates: { canonical: '/contact/' },
  title: 'Contact',
  description: "Bring one project. We'll wire it up with you: one real work item, run end to end, on a shared call.",
};

/**
 * The credential list moved to /pilot.
 *
 * It used to sit here under "You'll need", where it asked a sponsor booking a
 * walkthrough to go and find API keys before they could ask a question. A
 * walkthrough needs nothing prepared; a pilot does, and that is where the list
 * now lives.
 */
const FACTS: [string, string][] = [
  ['Typical reply', 'Within one business day, with a time and a short checklist.'],
  ['To see a walkthrough', 'Nothing to prepare. We screen-share the loop on a real ticket and answer questions as they come up.'],
  ['To run a pilot', 'One tracker project, one repository, one real work item, and the credentials listed on the pilot page.'],
  ['Either way', 'You keep whatever the session produces.'],
];

export default function ContactPage() {
  return (
    <div className="stack-1" style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', borderBottom: '2px solid var(--color-divider)' }}>
      {/* LEFT */}
      <div className="pad-x" style={{ padding: 64, borderRight: '2px solid var(--color-divider)' }}>
        <div className="kicker" style={{ marginBottom: 20 }}>Request access</div>
        <h1 className="h1-inner" style={{ fontSize: 56, fontWeight: 700, letterSpacing: '-0.022em', lineHeight: 1.02 }}>
          Bring one project. We&apos;ll wire it up with you.
        </h1>
        <p className="lead" style={{ marginTop: 22 }}>
          Tell us which you want. A walkthrough is a shared call with nothing to prepare. A pilot connects your tracker
          and repository and runs one real work item end to end, through generation, security scanning and a runbook.
        </p>
        <div className="rows" style={{ marginTop: 36 }}>
          {FACTS.map(([lead, body]) => (
            <p key={lead} className="prose">
              <strong style={{ fontWeight: 700, color: 'var(--color-text)' }}>{lead}.</strong> {body}
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
