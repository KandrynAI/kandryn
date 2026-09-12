'use client';

import { useState } from 'react';
import BoardView from '@/components/demo/BoardView';
import RunView from '@/components/demo/RunView';
import DashView from '@/components/demo/DashView';
import RunPanel from '@/components/demo/RunPanel';
import { Logo } from '@/components/Logo';
import { PREVIEW } from '@/lib/home';
import { DEMO_CODE_RAPTIA } from '@/lib/site';

type Screen = 'run' | 'board' | 'dashboard';
type Phase = 'idle' | 'running' | 'done' | 'committed';

/**
 * Section 2 — the dominant visual on the page.
 *
 * The previous version opened on a four-column Kanban board, which asked a
 * first-time visitor to understand a project-management surface before they
 * could understand the product. It now opens on the thing the product actually
 * produces: one work item and the change proposed for it. The board and the
 * dashboard are still here and still real — they moved from being the entry
 * point to being somewhere you can go.
 *
 * Mobile is not this laid out narrower. A four-column board and a two-pane run
 * workspace do not survive 390px no matter how they reflow, so small screens
 * get a purpose-built stacked progression driven by the same state.
 */
export default function ProductPreview() {
  const [screen, setScreen] = useState<Screen>('run');
  const [panelOpen, setPanelOpen] = useState(false);
  const [autoCommit, setAutoCommit] = useState(false);
  const [scheduleOn, setScheduleOn] = useState(false);
  const [phase, setPhase] = useState<Phase>('done');
  const [scheduled, setScheduled] = useState(false);
  const [tests, setTests] = useState(false);
  const [committedCount, setCommittedCount] = useState(21);

  const runNow = () => {
    setPanelOpen(false);
    if (scheduleOn) {
      setScheduled(true);
      setScreen('board');
      return;
    }
    setScreen('run');
    setPhase('running');
    setTests(false);
    setTimeout(() => {
      if (autoCommit) {
        setPhase('committed');
        setCommittedCount(22);
      } else {
        setPhase('done');
      }
    }, 4200);
  };

  const commit = () => {
    setPhase('committed');
    setCommittedCount(22);
  };

  const runPhase: 'running' | 'done' | 'committed' = phase === 'idle' ? 'running' : phase;

  const SECONDARY: { key: Screen; label: string }[] = [
    { key: 'run', label: 'The change' },
    { key: 'board', label: 'Board' },
    { key: 'dashboard', label: 'Dashboard' },
  ];

  return (
    <section
      id="preview"
      className="pad-x"
      style={{ padding: '72px 64px', borderBottom: '2px solid var(--color-divider)', scrollMarginTop: 80 }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 20,
          flexWrap: 'wrap',
        }}
      >
        <h2 style={{ fontSize: 38, fontWeight: 800, letterSpacing: '-0.025em' }}>{PREVIEW.title}</h2>
        <span style={{ fontSize: 13, color: 'var(--color-neutral-700)' }}>
          Interactive — sample project
        </span>
      </div>
      <p
        style={{
          marginTop: 12,
          maxWidth: 640,
          fontSize: 17,
          lineHeight: 1.5,
          color: 'var(--color-neutral-800)',
          textWrap: 'pretty',
        }}
      >
        {PREVIEW.lead}
      </p>

      {/* ---------- Desktop / tablet: the real app surface ---------- */}
      <div className="preview-wide" style={{ marginTop: 32, border: '2px solid var(--color-divider)' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 24,
            padding: '0 18px',
            borderBottom: '2px solid var(--color-divider)',
            background: 'var(--color-neutral-200)',
            overflowX: 'auto',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              paddingRight: 18,
              borderRight: '2px solid var(--color-divider)',
              height: 46,
              flexShrink: 0,
            }}
          >
            <Logo context="nav-light" height={18} />
          </div>

          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {SECONDARY.map((t) => {
              const active = screen === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setScreen(t.key)}
                  style={{
                    fontSize: 13,
                    fontWeight: active ? 700 : 500,
                    padding: '13px 14px',
                    background: active ? 'var(--color-bg)' : 'transparent',
                    color: active ? 'var(--color-text)' : 'var(--color-neutral-700)',
                    boxShadow: active ? 'inset 0 -3px 0 var(--color-accent)' : 'none',
                    border: 'none',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          <div
            style={{
              marginLeft: 'auto',
              display: 'flex',
              gap: 14,
              fontSize: 12,
              color: 'var(--color-neutral-700)',
              flexShrink: 0,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
              <span style={{ width: 7, height: 7, background: '#1f9d55', display: 'block' }} />
              Jira connected
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
              <span style={{ width: 7, height: 7, background: '#1f9d55', display: 'block' }} />
              GitHub connected
            </span>
          </div>
        </div>

        <div style={{ position: 'relative', minHeight: 660, overflowX: 'auto' }}>
          {screen === 'board' && (
            <BoardView
              committed={phase === 'committed'}
              scheduled={scheduled}
              onRun={() => setPanelOpen(true)}
            />
          )}
          {screen === 'run' && (
            <RunView
              phase={runPhase}
              tests={tests}
              onBack={() => setScreen('board')}
              onCommit={commit}
              onToggleTests={() => setTests((v) => !v)}
              onDash={() => setScreen('dashboard')}
            />
          )}
          {screen === 'dashboard' && <DashView phase={runPhase} committedCount={committedCount} />}

          {panelOpen && (
            <RunPanel
              autoCommit={autoCommit}
              setAutoCommit={setAutoCommit}
              scheduleOn={scheduleOn}
              setScheduleOn={setScheduleOn}
              onRunNow={runNow}
              onClose={() => setPanelOpen(false)}
            />
          )}
        </div>
      </div>

      {/* ---------- Small screens: a stacked single-task progression ---------- */}
      <MobilePreview phase={runPhase} onCommit={commit} />
    </section>
  );
}

/**
 * The small-screen view.
 *
 * Three stacked cards — the item, the proposed change, the pull request —
 * following the same order the desktop workspace reads in, with the same
 * commit interaction. Built rather than reflowed: the desktop surface has two
 * side-by-side proposals and a five-dimension score table, and neither is
 * legible on a phone. What survives is the part that carries the idea.
 */
function MobilePreview({
  phase,
  onCommit,
}: {
  phase: 'running' | 'done' | 'committed';
  onCommit: () => void;
}) {
  const committed = phase === 'committed';
  const cardStyle = {
    border: '2px solid var(--color-divider)',
    background: 'var(--color-bg)',
  } as const;

  return (
    <div className="preview-narrow" style={{ marginTop: 28, display: 'grid', gap: 16 }}>
      {/* 1 — the work item */}
      <div style={cardStyle}>
        <Step n="01" label="The work item" />
        <div style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <span className="tag tag-outline">STORY</span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                color: 'var(--color-neutral-700)',
              }}
            >
              PAY-214
            </span>
          </div>
          <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.35 }}>
            Idempotency keys on the refund endpoint
          </div>
        </div>
      </div>

      {/* 2 — the proposed change */}
      <div style={cardStyle}>
        <Step n="02" label="The proposed change" />
        <div
          style={{
            padding: '10px 14px',
            borderBottom: '2px solid var(--color-divider)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--color-neutral-700)',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>src/routes/refunds.ts</span>
          <span style={{ whiteSpace: 'nowrap', fontWeight: 700, color: 'var(--color-accent-700)' }}>
            9.2 / 10
          </span>
        </div>
        <pre
          style={{
            margin: 0,
            padding: '12px 14px',
            overflowX: 'auto',
            fontSize: 11.5,
            lineHeight: 1.65,
            background: 'var(--color-neutral-100)',
            color: 'var(--color-neutral-900)',
          }}
        >
          {DEMO_CODE_RAPTIA}
        </pre>
        <div style={{ padding: '12px 14px', borderTop: '2px solid var(--color-divider)' }}>
          {committed ? (
            <span style={{ fontSize: 14, fontWeight: 700, color: '#1f7a4d' }}>
              Committed to <span style={{ fontFamily: 'var(--font-mono)' }}>task/214</span>
            </span>
          ) : (
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={onCommit}>
              Commit this change
            </button>
          )}
        </div>
      </div>

      {/* 3 — the pull request */}
      {/* 0.55 read as "pending" but dropped this card's text to 2.37:1. 0.9 keeps
          the state legible as dimmed while clearing AA. */}
      <div style={{ ...cardStyle, opacity: committed ? 1 : 0.9 }}>
        <Step n="03" label="The pull request" />
        <div style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.35 }}>
            [Kandryn] Idempotency keys on the refund endpoint
          </div>
          <div style={{ marginTop: 8, fontSize: 13, color: 'var(--color-neutral-700)' }}>
            {committed
              ? 'Open for review. Kandryn does not merge it.'
              : 'Opens once you commit a change above.'}
          </div>
        </div>
      </div>
    </div>
  );
}

function Step({ n, label }: { n: string; label: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        borderBottom: '2px solid var(--color-divider)',
        background: 'var(--color-neutral-200)',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.1em',
          color: 'var(--color-accent-700)',
        }}
      >
        {n}
      </span>
      <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.01em' }}>{label}</span>
    </div>
  );
}
