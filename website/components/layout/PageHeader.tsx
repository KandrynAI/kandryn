import type { ReactNode } from 'react';

export default function PageHeader({
  kicker,
  title,
  lead,
}: {
  kicker?: string;
  title: ReactNode;
  lead?: ReactNode;
}) {
  return (
    <header className="pad-x" style={{ padding: '64px 64px 48px', borderBottom: '2px solid var(--color-divider)' }}>
      {kicker && <div className="kicker" style={{ marginBottom: 20 }}>{kicker}</div>}
      <h1 className="h1-inner" style={{ fontSize: 64, fontWeight: 900, letterSpacing: '-0.035em', lineHeight: 0.98 }}>
        {title}
      </h1>
      {lead && (
        <p style={{ fontSize: 18, lineHeight: 1.5, color: 'var(--color-neutral-800)', marginTop: 22, maxWidth: 760, textWrap: 'pretty' }}>
          {lead}
        </p>
      )}
    </header>
  );
}
