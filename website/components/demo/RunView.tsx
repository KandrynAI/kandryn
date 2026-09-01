import { useState } from 'react';
import { DEMO_CODE_RAPTIA, DEMO_CODE_FOVEA, DEMO_TESTS } from '@/lib/site';

type Phase = 'running' | 'done' | 'committed';

const INFO = [
  ['TRIGGER', 'Manual'],
  ['AUTO-COMMIT', 'Off'],
  ['REPOSITORY', 'acme/payments-api'],
  ['STACK', 'Node · Express · Drizzle'],
];

type ScoreDim = { score: number; label: string };
const SUGGESTIONS: {
  agent: string;
  recommended: boolean;
  score: number;
  file: string;
  code: string;
  explanation: string;
  scoreBreakdown: ScoreDim[];
}[] = [
  {
    agent: 'Raptia',
    recommended: true,
    score: 9.2,
    file: 'src/routes/refunds.ts',
    code: DEMO_CODE_RAPTIA,
    explanation:
      'Adds an idempotency guard that reads the header, returns the stored refund on a replay, and writes the row and its ledger entries inside one transaction — matching the repository’s existing Drizzle helper. Synthesia ranked it first.',
    scoreBreakdown: [
      { score: 94, label: 'Correctness' },
      { score: 88, label: 'Readability' },
      { score: 91, label: 'Minimal diff' },
      { score: 78, label: 'Conventions' },
      { score: 92, label: 'AC coverage' },
    ],
  },
  {
    agent: 'Fovea',
    recommended: false,
    score: 7.1,
    file: 'src/lib/idempotency.ts',
    code: DEMO_CODE_FOVEA,
    explanation:
      'A smaller in-memory memoiser. Correct for a single process, but it does not survive a restart or share state across the settlement workers, so Synthesia ranked it second.',
    scoreBreakdown: [
      { score: 72, label: 'Correctness' },
      { score: 90, label: 'Readability' },
      { score: 68, label: 'Minimal diff' },
      { score: 62, label: 'Conventions' },
      { score: 48, label: 'AC coverage' },
    ],
  },
];

function Badge({ phase }: { phase: Phase }) {
  const running = phase === 'running';
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 800,
        lineHeight: 1,
        letterSpacing: '0.1em',
        padding: '5px 9px',
        background: running ? 'var(--color-accent-200)' : 'var(--color-neutral-300)',
        color: running ? 'var(--color-accent-800)' : 'var(--color-neutral-900)',
      }}
    >
      {running ? 'RUNNING' : 'SUCCEEDED'}
    </span>
  );
}

export default function RunView({
  phase,
  tests,
  onBack,
  onCommit,
  onToggleTests,
  onDash,
}: {
  phase: Phase;
  tests: boolean;
  onBack: () => void;
  onCommit: () => void;
  onToggleTests: () => void;
  onDash: () => void;
}) {
  const showSuggestions = phase === 'done' || phase === 'committed';
  const [postCommitStep, setPostCommitStep] = useState<null | 'veria' | 'aegis' | 'narratia'>(null);

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 22, fontWeight: 800 }}>Run #1042</span>
            <Badge phase={phase} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-neutral-700)', marginTop: 4 }}>
            PAY-214 · Idempotency keys on the refund endpoint
          </div>
        </div>
        <button className="btn btn-ghost" style={{ fontSize: 13, padding: '8px 14px' }} onClick={onBack}>
          Back to board
        </button>
      </div>

      {/* Info strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderBottom: '2px solid var(--color-divider)' }}>
        {INFO.map(([label, value]) => (
          <div key={label} style={{ padding: '16px 0 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', color: 'var(--color-neutral-600)' }}>{label}</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* RUNNING */}
      {phase === 'running' && (
        <div style={{ paddingTop: 40, display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 720 }}>
          {[
            ['Raptia', 'writing the change'],
            ['Fovea', 'drafting an alternative'],
          ].map(([agent, step]) => (
            <div key={agent}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{agent}</span>
                <span style={{ color: 'var(--color-neutral-700)' }}>{step}</span>
              </div>
              <div style={{ height: 6, background: 'var(--color-neutral-300)' }}>
                <div style={{ height: 6, background: 'var(--color-accent)', animation: 'bmbar 4s ease-out forwards' }} />
              </div>
            </div>
          ))}

          {/* Synthesia waits for the two generators, then ranks. */}
          <div style={{ borderTop: '1px solid var(--color-neutral-300)', paddingTop: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>Synthesia</span>
              <span style={{ color: 'var(--color-neutral-700)' }}>ranking suggestions</span>
            </div>
            <div style={{ height: 6, background: 'var(--color-neutral-300)' }}>
              <div style={{ height: 6, background: 'var(--color-accent)', width: 0, animation: 'bmbar 2s ease-out 4s forwards' }} />
            </div>
          </div>

          <div style={{ fontSize: 13, color: 'var(--color-neutral-700)', animation: 'bmblink 1.4s infinite' }}>
            Fetching repository context · extracting keywords · Synthesia ranking…
          </div>

          {/* post-commit teaser — Veria/Aegis/Narratia run after you commit */}
          <div style={{ borderTop: '1px solid var(--color-neutral-300)', paddingTop: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', color: 'var(--color-neutral-600)', marginBottom: 10 }}>POST-COMMIT</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--color-neutral-600)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-neutral-400)', display: 'block' }} />
                Veria · Aegis · Narratia
              </span>
              <span>run after commit</span>
            </div>
          </div>
        </div>
      )}

      {/* SUGGESTIONS (done + committed) */}
      {showSuggestions && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 20 }}>
          {/* Synthesia confidence banner */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '10px 14px', background: 'var(--color-accent-100)', border: '1px solid var(--color-accent)', fontSize: 13 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>Synthesia</span>
            <span style={{ color: 'var(--color-neutral-600)' }}>→</span>
            <span style={{ fontWeight: 700 }}>Raptia recommended</span>
            <span style={{ color: 'var(--color-neutral-600)' }}>·</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>87% confidence</span>
            <span style={{ color: 'var(--color-neutral-700)', fontStyle: 'italic' }}>“Raptia’s transaction wrapper is the decisive factor.”</span>
          </div>
          {SUGGESTIONS.map((s) => (
            <div
              key={s.agent}
              style={{ border: '2px solid var(--color-divider)', background: 'var(--color-neutral-100)', animation: 'bmrise 0.35s ease-out both' }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--color-neutral-300)',
                }}
              >
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500 }}>{s.agent}</span>
                {s.recommended && <span className="tag tag-accent">Recommended</span>}
                <span style={{ fontSize: 12, color: 'var(--color-neutral-700)' }}>score {s.score}</span>
                <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-neutral-700)' }}>
                  {s.file}
                </span>
                <button className="btn btn-primary" style={{ padding: '8px 14px', fontSize: 12 }} onClick={onCommit}>
                  Commit
                </button>
              </div>
              <div style={{ padding: '12px 16px', fontSize: 13, lineHeight: 1.5, color: 'var(--color-neutral-800)', borderBottom: '1px solid var(--color-neutral-300)' }}>
                {s.explanation}
              </div>
              {/* Synthesia score breakdown */}
              <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6, borderBottom: '1px solid var(--color-neutral-300)' }}>
                {s.scoreBreakdown.map((dim) => (
                  <div key={dim.label} style={{ display: 'grid', gridTemplateColumns: '96px 1fr 28px', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 10, color: 'var(--color-neutral-700)' }}>{dim.label}</span>
                    <span style={{ height: 3, background: 'var(--color-neutral-300)', display: 'block' }}>
                      <span style={{ height: 3, background: 'var(--color-accent)', width: `${dim.score}%`, display: 'block' }} />
                    </span>
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--color-neutral-700)', textAlign: 'right' }}>{dim.score}</span>
                  </div>
                ))}
              </div>
              <pre style={{ margin: 0, padding: '14px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6, overflow: 'auto', background: 'var(--color-neutral-200)' }}>
                {s.code}
              </pre>
            </div>
          ))}
        </div>
      )}

      {/* COMMIT BANNER */}
      {phase === 'committed' && (
        <div
          style={{
            marginTop: 20,
            border: '2px solid var(--color-accent)',
            background: 'var(--color-accent-100)',
            padding: 16,
            animation: 'bmrise 0.35s ease-out both',
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 800 }}>
            Committed to <code style={{ fontFamily: 'var(--font-mono)' }}>task/214</code> — pull request opened
          </div>
          <div style={{ fontSize: 13, marginTop: 6, color: 'var(--color-accent-800)' }}>
            acme/payments-api #318 · [Kandryn] Idempotency keys on the refund endpoint · PAY-214 moved to Review
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" style={{ fontSize: 13, padding: '10px 16px' }} onClick={onToggleTests}>
              {tests ? 'Tests generated' : 'Generate tests'}
            </button>
            <button className="btn btn-ghost" style={{ fontSize: 13, padding: '10px 16px' }} onClick={onDash}>
              See it on the dashboard
            </button>
          </div>

          {/* Post-commit agents — Veria, Aegis, Narratia (demo previews) */}
          <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" style={{ fontSize: 13, padding: '10px 16px' }} onClick={() => setPostCommitStep('veria')}>
              Run Veria review
            </button>
            <button className="btn btn-ghost" style={{ fontSize: 13, padding: '10px 16px' }} onClick={() => setPostCommitStep('aegis')}>
              Run Aegis security scan
            </button>
            <button className="btn btn-ghost" style={{ fontSize: 13, padding: '10px 16px' }} onClick={() => setPostCommitStep('narratia')}>
              Generate runbook (Narratia)
            </button>
          </div>

          {postCommitStep === 'veria' && (
            <div style={{ marginTop: 12, background: 'var(--color-neutral-100)', border: '1px solid var(--color-accent)', borderRadius: 4, padding: '10px 14px', animation: 'bmrise 0.3s ease-out both' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13 }}>Veria</span>
                <span className="tag tag-accent">Review complete</span>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.7 }}>
                <div>✓ Idempotency key check on POST /refund</div>
                <div>✓ Transaction wraps insert and ledger entry</div>
                <div style={{ color: 'var(--color-neutral-700)' }}>◑ Error response format — 400 but no body schema</div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-neutral-700)', marginTop: 8 }}>
                Focus: the 400 response on a missing key has no body — the caller cannot distinguish it from a server error.
              </div>
            </div>
          )}

          {postCommitStep === 'aegis' && (
            <div style={{ marginTop: 12, background: 'var(--color-neutral-100)', border: '1px solid #c0392b', borderRadius: 4, padding: '10px 14px', animation: 'bmrise 0.3s ease-out both' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13 }}>Aegis</span>
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', padding: '2px 8px', borderRadius: 3, background: 'var(--color-accent-100)', color: 'var(--color-accent-800)' }}>Gate approved</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', padding: '2px 6px', borderRadius: 3, background: '#fbe4c4', color: '#78350f' }}>MEDIUM</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-neutral-700)' }}>A09</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Refund amount not logged</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-neutral-700)', marginTop: 6 }}>
                The refund amount is not included in the audit log entry, making post-incident reconstruction harder.
              </div>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px', marginTop: 8 }}>Push to tracker</button>
            </div>
          )}

          {postCommitStep === 'narratia' && (
            <div style={{ marginTop: 12, background: 'var(--color-neutral-100)', border: '1px solid var(--color-accent)', borderRadius: 4, padding: '10px 14px', animation: 'bmrise 0.3s ease-out both' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13 }}>Narratia</span>
                <span className="tag tag-accent">Runbook ready</span>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.7 }}>
                <div>✓ Summary — idempotency keys added to POST /refund</div>
                <div>✓ Deployment steps — no migration required</div>
                <div>✓ Rollback — revert task/214, close PR</div>
                <div>✓ Validation — replay the same key twice, expect 200 both times</div>
                <div>✓ Security notes — Aegis gate approved, 1 medium finding</div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px' }}>Markdown to PR</button>
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px' }}>Confluence</button>
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px' }}>Notion</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TESTS */}
      {phase === 'committed' && tests && (
        <div style={{ marginTop: 16, border: '2px solid var(--color-divider)', animation: 'bmrise 0.35s ease-out both' }}>
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--color-neutral-300)',
              fontSize: 13,
              fontWeight: 700,
              display: 'flex',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <span>Generated test cases</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 400, color: 'var(--color-neutral-700)' }}>
              vitest · tests/refunds.idempotency.test.ts → stacked on PR #318
            </span>
          </div>
          {DEMO_TESTS.map((t, i) => (
            <div key={i} style={{ padding: '10px 16px', borderBottom: '1px solid var(--color-neutral-200)', fontSize: 13, lineHeight: 1.5 }}>
              <strong>Given</strong> {t.given} <strong>When</strong> {t.when} <strong>Then</strong> {t.then}
            </div>
          ))}
          <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--color-neutral-700)' }}>
            Selected cases push back into Jira as linked test cases.
          </div>
        </div>
      )}
    </div>
  );
}
