import Btn from '@/components/ui/Btn';
import { CLOSING } from '@/lib/home';

/**
 * The last section. Two routes to the same conversation, not two offers.
 *
 * The pilot is the real ask: one work item, end to end. The walkthrough sits
 * beside it for a sponsor who is not ready to bring credentials to a call, and
 * who would otherwise leave rather than click the harder of the two.
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
          fontWeight: 700,
          letterSpacing: '-0.02em',
          lineHeight: 1.05,
          maxWidth: 640,
          textWrap: 'balance',
        }}
      >
        {CLOSING.headline}
      </h2>
      <p style={{ marginTop: 16, maxWidth: 520, fontSize: 17, lineHeight: 1.6, opacity: 0.92 }}>
        {CLOSING.body}
      </p>
      <div style={{ marginTop: 32, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Btn
          variant="secondary"
          href={CLOSING.cta.href}
          style={{ background: '#ffffff', color: 'var(--color-accent-700)', borderColor: '#ffffff' }}
        >
          {CLOSING.cta.label}
        </Btn>
        <Btn
          variant="secondary"
          href={CLOSING.secondary.href}
          style={{ background: 'transparent', color: '#ffffff', borderColor: '#ffffff' }}
        >
          {CLOSING.secondary.label}
        </Btn>
      </div>
    </section>
  );
}
