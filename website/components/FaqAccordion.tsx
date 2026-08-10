'use client';

import { useState } from 'react';
import { FAQS } from '@/lib/site';

export default function FaqAccordion() {
  const [open, setOpen] = useState<number>(0);

  return (
    <div className="pad-x" style={{ padding: '0 64px 56px' }}>
      {FAQS.map((f, i) => {
        const isOpen = open === i;
        return (
          <div key={f.q} style={{ borderBottom: '2px solid var(--color-divider)' }}>
            <button
              onClick={() => setOpen(isOpen ? -1 : i)}
              aria-expanded={isOpen}
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                gap: 24,
                padding: '22px 0',
                background: 'none',
                border: 0,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--color-text)' }}>{f.q}</span>
              <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-accent-700)', flexShrink: 0 }}>
                {isOpen ? '–' : '+'}
              </span>
            </button>
            {isOpen && (
              <p style={{ fontSize: 16, lineHeight: 1.6, color: 'var(--color-neutral-800)', maxWidth: 820, padding: '0 0 24px', textWrap: 'pretty' }}>
                {f.a}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
