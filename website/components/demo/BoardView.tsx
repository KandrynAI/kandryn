import { DEMO_BOARD_ITEMS } from '@/lib/site';

type Item = (typeof DEMO_BOARD_ITEMS)[number];

const COLUMNS: { key: string; label: string }[] = [
  { key: 'open', label: 'OPEN' },
  { key: 'progress', label: 'IN PROGRESS' },
  { key: 'review', label: 'REVIEW' },
  { key: 'done', label: 'DONE' },
];

export default function BoardView({
  committed,
  scheduled,
  onRun,
}: {
  committed: boolean;
  scheduled: boolean;
  onRun: () => void;
}) {
  // Cross-screen state: once committed, PAY-214 moves to review.
  const items: Item[] = DEMO_BOARD_ITEMS.map((it) =>
    it.key === 'PAY-214' && committed
      ? { ...it, col: 'review', plmStatus: 'In Review', canRun: false }
      : it,
  );

  return (
    <div style={{ padding: '22px 24px 28px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 16,
          paddingBottom: 16,
          borderBottom: '2px solid var(--color-divider)',
        }}
      >
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em' }}>Payments Platform</div>
          <div style={{ fontSize: 12, color: 'var(--color-neutral-700)', marginTop: 4 }}>
            jira · PAY · 9 items · synced 4 minutes ago
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
          <button className="btn btn-ghost" style={{ fontSize: 13, padding: '8px 14px' }}>Sync</button>
          <button className="btn btn-secondary" style={{ fontSize: 13, padding: '8px 14px' }}>New item</button>
        </div>
      </div>

      {/* Epic filter chips */}
      <div style={{ display: 'flex', gap: 8, padding: '14px 0 18px', flexWrap: 'wrap' }}>
        <span className="tag tag-accent">All epics</span>
        <span className="tag tag-outline">Checkout</span>
        <span className="tag tag-outline">Refunds</span>
        <span className="tag tag-outline">Ledger</span>
      </div>

      {/* Kanban */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          borderTop: '2px solid var(--color-divider)',
          minWidth: 720,
        }}
      >
        {COLUMNS.map((col) => {
          const colItems = items.filter((it) => it.col === col.key);
          return (
            <div
              key={col.key}
              style={{ borderRight: '2px solid var(--color-divider)', padding: '14px 14px 24px', minHeight: 420 }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 12,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.1em', color: 'var(--color-neutral-800)' }}>
                  {col.label}
                </span>
                <span style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>{colItems.length}</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {colItems.map((it) => {
                  const showRun = it.canRun && !(it.key === 'PAY-214' && committed);
                  const showScheduled = it.key === 'PAY-214' && scheduled && !committed;
                  return (
                    <div
                      key={it.key}
                      style={{
                        background: 'var(--color-neutral-100)',
                        border: '1px solid var(--color-neutral-300)',
                        padding: '12px 12px 10px',
                        boxShadow: 'var(--shadow-sm)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 800,
                            letterSpacing: '0.1em',
                            padding: '2px 6px',
                            background: 'var(--color-neutral-300)',
                            color: 'var(--color-neutral-800)',
                          }}
                        >
                          {it.type}
                        </span>
                        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--color-neutral-700)' }}>
                          {it.key}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35, textWrap: 'pretty' }}>{it.title}</div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          marginTop: 10,
                        }}
                      >
                        <span style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>{it.plmStatus}</span>
                        {showScheduled ? (
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-accent-700)' }}>◷ 21:00</span>
                        ) : showRun ? (
                          <button
                            className="demo-run-btn"
                            onClick={onRun}
                            style={{
                              fontFamily: 'var(--font-archivo)',
                              fontWeight: 600,
                              fontSize: 11,
                              lineHeight: 1,
                              letterSpacing: '0.06em',
                              padding: '6px 10px',
                              border: '1px solid var(--color-accent)',
                              background: 'transparent',
                              color: 'var(--color-accent-700)',
                              cursor: 'pointer',
                            }}
                          >
                            RUN
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
