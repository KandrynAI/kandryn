'use client';

import { useState } from 'react';
import BoardView from '@/components/demo/BoardView';
import RunView from '@/components/demo/RunView';
import DashView from '@/components/demo/DashView';
import RunPanel from '@/components/demo/RunPanel';

type Screen = 'board' | 'run' | 'dashboard';
type Phase = 'idle' | 'running' | 'done' | 'committed';

const TABS: { key: Screen; label: string }[] = [
  { key: 'board', label: 'Board' },
  { key: 'run', label: 'Run #1042' },
  { key: 'dashboard', label: 'Dashboard' },
];

export default function DemoSection() {
  const [screen, setScreen] = useState<Screen>('board');
  const [panelOpen, setPanelOpen] = useState(false);
  const [autoCommit, setAutoCommit] = useState(false);
  const [scheduleOn, setScheduleOn] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
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

  return (
    <section className="pad-x" style={{ padding: '56px 64px 72px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, marginBottom: 8, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.02em' }}>Try the loop</h2>
        <span style={{ fontSize: 13, color: 'var(--color-neutral-700)' }}>Live demo — click through with sample data</span>
      </div>
      <p style={{ fontSize: 16, color: 'var(--color-neutral-800)', marginBottom: 28, maxWidth: 720 }}>
        Pick a work item, run the agents, commit the suggestion you want. Nothing here is a screenshot.
      </p>

      {/* Demo window */}
      <div style={{ border: '2px solid var(--color-divider)' }}>
        {/* Chrome bar */}
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/bluemantis-mark-dark.png" alt="Blue Mantis" style={{ height: 18, width: 'auto' }} />
            <span style={{ fontSize: 13, fontWeight: 800 }}>Blue Mantis</span>
          </div>

          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {TABS.map((t) => {
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

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 14, fontSize: 12, color: 'var(--color-neutral-700)', flexShrink: 0 }}>
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

        {/* Body */}
        <div style={{ position: 'relative', minHeight: 660, overflowX: 'auto' }}>
          {screen === 'board' && <BoardView committed={phase === 'committed'} scheduled={scheduled} onRun={() => setPanelOpen(true)} />}
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
    </section>
  );
}
