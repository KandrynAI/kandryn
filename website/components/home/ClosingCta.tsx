import Btn from '@/components/ui/Btn';
import { CLOSING } from '@/lib/home';

/**
 * Section 6 — the same action the hero opened with, and nothing else.
 *
 * No second offer, no newsletter, no pricing. A visitor who reached the bottom
 * has one decision left to make, and giving them a choice at this point is
 * giving them a way not to decide.
 */
export default function ClosingCta() {
  return (
    <section
      className="pad-x"
      style={{ padding: '84px 64px', background: 'var(--color-accent)', color: '#ffffff' }}
    >
      <h2
        style={{
          fontSize: 46,
          fontWeight: 900,
          letterSpacing: '-0.03em',
          lineHeight: 1.05,
          maxWidth: 640,
          textWrap: 'balance',
        }}
      >
        {CLOSING.headline}
      </h2>
      <p style={{ marginTop: 16, maxWidth: 520, fontSize: 17, lineHeight: 1.5, opacity: 0.92 }}>
        {CLOSING.body}
      </p>
      <div style={{ marginTop: 32 }}>
        <Btn
          variant="secondary"
          href={CLOSING.cta.href}
          style={{ background: '#ffffff', color: 'var(--color-accent-700)', borderColor: '#ffffff' }}
        >
          {CLOSING.cta.label}
        </Btn>
      </div>
    </section>
  );
}
