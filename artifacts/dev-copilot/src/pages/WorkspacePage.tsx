import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useLocation } from 'wouter';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StackBadge } from '@/components/dc/StackBadge';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { Stepper } from '@/components/workspace/Stepper';
import { useRepo } from '@/context/RepoContext';
import {
  generateSuggestions, commitCode, completeTask, fetchTasks,
  type DevCopilotTask, type CodeSuggestion,
} from '@/services/api';

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

const SOURCE_LABELS: Record<string, string> = { 'azure-devops': 'Azure DevOps', jira: 'JIRA', github: 'GitHub', manual: 'Manual' };
const TYPE_LABELS: Record<string, string> = { feature: 'Feature', story: 'Story', epic: 'Epic', chore: 'Task', task: 'Task', bug: 'Bug' };
const PRIORITY_LABELS: Record<string, string> = { critical: 'P1', high: 'P2', medium: 'P3', low: 'P4' };

const AGENT_META: Record<string, { label: string; color: string }> = {
  claude:      { label: 'Raptia', color: '#1a4fd6' },
  openai:      { label: 'Fovea',  color: '#3a6cf0' },
  antigravity: { label: 'Raptia', color: '#1a4fd6' },
  copilot:     { label: 'Fovea',  color: '#3a6cf0' },
};

function langFromPath(p: string): string {
  const ext = p.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = { ts: 'typescript', tsx: 'typescript', cs: 'csharp', java: 'java', py: 'python', html: 'html', sql: 'sql', js: 'javascript', jsx: 'javascript' };
  return map[ext] ?? 'typescript';
}

const CODE_STYLE = {
  background: '#0D0F12',
  fontSize: '13px',
  fontFamily: 'var(--font-mono)',
  lineHeight: '1.6',
  padding: '16px',
  margin: 0,
  borderRadius: 0,
};

function criteriaLines(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split('\n').map((l) => l.replace(/^[\s\-*]+/, '').trim()).filter(Boolean);
}

const SECTION_LABEL: React.CSSProperties = {
  fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.08em',
  textTransform: 'uppercase', fontWeight: 500, fontFamily: 'var(--font-sans)', display: 'block', marginBottom: 8,
};

const DIVIDER: React.CSSProperties = {
  height: 1, background: 'var(--hairline)', margin: '16px 0', border: 'none',
};

function SparkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <path d="M7 1l1.5 4.5L13 7l-4.5 1.5L7 13l-1.5-4.5L1 7l4.5-1.5L7 1z" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="5" width="8" height="8" rx="1.5" />
      <path d="M9 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h2" />
    </svg>
  );
}

function SuccessCircle() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
      <circle cx="32" cy="32" r="28" stroke="var(--accent-green)" strokeWidth="3" fill="none"
        strokeDasharray="176" strokeDashoffset="176"
        style={{ animation: 'dc-draw-circle 0.5s ease forwards' }} />
      <path d="M18 32L28 42L46 22" stroke="var(--accent-green)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
        strokeDasharray="60" strokeDashoffset="60"
        style={{ animation: 'dc-draw-check 0.3s ease 0.5s forwards' }} />
    </svg>
  );
}

/* ─── Loading dots ────────────────────────────────────────────────────────── */
function LoadingDots({ color }: { color: string }) {
  return (
    <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center', padding: '20px 16px' }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{
          width: 8, height: 8, borderRadius: '50%', background: color,
          animation: `dc-bounce-dot 1s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>Generating…</span>
    </span>
  );
}

/* ─── WorkspacePage ───────────────────────────────────────────────────────── */

export default function WorkspacePage() {
  const params = useParams<{ taskId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { stackProfile } = useRepo();
  const taskId = Number(params.taskId);

  const [task, setTask] = useState<DevCopilotTask | null>(null);
  const [suggestions, setSuggestions] = useState<CodeSuggestion[]>([]);
  const [acceptedSuggestion, setAcceptedSuggestion] = useState<CodeSuggestion | null>(null);
  const [commitHash, setCommitHash] = useState<string | null>(null);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);
  const [isComplete, setIsComplete] = useState(false);
  const [refinementPrompt, setRefinementPrompt] = useState('');
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [initLoading, setInitLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);
  const [activeAgent, setActiveAgent] = useState<string>('');
  const [commitMessage, setCommitMessage] = useState('');
  const [criteria, setCriteria] = useState<Record<number, boolean>>({});
  const [mobileBannerDismissed, setMobileBannerDismissed] = useState(false);
  const [mobileTab, setMobileTab] = useState<'task' | 'suggestions' | 'actions'>('task');
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  /* ── On mount: load task then generate ─────────────────────────────────── */
  const doGenerate = useCallback(async (refine?: string) => {
    setIsGenerating(true);
    try {
      const data = await generateSuggestions(taskId, refine);
      setSuggestions(data);
      const rec = data.find((s) => s.recommendation === 'Recommended');
      setActiveAgent(rec?.agent ?? data[0]?.agent ?? 'claude');
      setCurrentStep(1);
      toast({ title: 'Suggestions generated' });
    } catch (err) {
      toast({ title: `Failed to generate — ${err instanceof Error ? err.message : 'Unknown error'}`, variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  }, [taskId, toast]);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      setInitLoading(true);
      try {
        const all = await fetchTasks();
        const found = all.find((t) => t.id === taskId) ?? null;
        if (cancelled) return;
        if (!found) throw new Error('Task not found');
        setTask(found);
        setCommitMessage(found.title);
        await doGenerate();
      } catch (err) {
        if (!cancelled) setInitError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!cancelled) setInitLoading(false);
      }
    };
    void init();
    return () => { cancelled = true; };
  }, [taskId, doGenerate]);

  /* page title */
  useEffect(() => {
    if (task && stackProfile) {
      document.title = `Kandryn — ${task.title} [${stackProfile.frontend} · ${stackProfile.backend}]`;
    } else {
      document.title = 'Kandryn — Loading…';
    }
  }, [task, stackProfile]);

  /* ── Keyboard shortcuts ─────────────────────────────────────────────────── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') { if (!(e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement)) void doGenerate(refinementPrompt || undefined); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { if (acceptedSuggestion && !isCommitting) void handleCommit(); }
      if (e.key === 'Escape') { if (confirmDialogOpen) setConfirmDialogOpen(false); else if (shortcutsOpen) setShortcutsOpen(false); }
      if (e.key === '?') setShortcutsOpen((o) => !o);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [acceptedSuggestion, isCommitting, confirmDialogOpen, shortcutsOpen, refinementPrompt, doGenerate]);

  /* ── Handlers ────────────────────────────────────────────────────────────── */
  const handleCommit = async () => {
    if (!acceptedSuggestion) return;
    setIsCommitting(true);
    try {
      const { commitHash: ch, prUrl: pr } = await commitCode(taskId, (acceptedSuggestion.files[0]?.filePath ?? ''), (acceptedSuggestion.files[0]?.content ?? ''), commitMessage);
      setCommitHash(ch);
      setPrUrl(pr);
      setCurrentStep(3);
      toast({ title: 'PR opened successfully' });
    } catch (err) {
      toast({ title: `Commit failed — ${err instanceof Error ? err.message : 'Unknown error'}`, variant: "destructive" });
    } finally {
      setIsCommitting(false);
    }
  };

  const handleComplete = async () => {
    if (!commitHash) return;
    setIsCompleting(true);
    try {
      await completeTask(taskId, commitHash);
      setIsComplete(true);
      setCurrentStep(4);
      setConfirmDialogOpen(false);
      toast({ title: `Task closed in ${task?.source ?? 'tracker'}` });
    } catch (err) {
      toast({ title: `Could not close task — ${err instanceof Error ? err.message : 'Unknown error'}`, variant: "destructive" });
    } finally {
      setIsCompleting(false);
    }
  };

  const copyToClipboard = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopyFeedback(key);
    toast({ title: 'Code copied' });
    setTimeout(() => setCopyFeedback(null), 2000);
  };

  const sortedSuggestions = [...suggestions].sort((a, b) => {
    if (a.recommendation === 'Recommended') return -1;
    if (b.recommendation === 'Recommended') return 1;
    return (b.score ?? 0) - (a.score ?? 0);
  });

  const activeSuggestion = sortedSuggestions.find((s) => s.agent === activeAgent) ?? sortedSuggestions[0] ?? null;
  const criteriaList = criteriaLines(task?.acceptanceCriteria ?? null);

  /* ── Loading / error ─────────────────────────────────────────────────────── */
  if (initLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 32 }}>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (initError || !task) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 16, textAlign: 'center' }}>
        <p style={{ color: 'var(--accent-red)', fontSize: 13 }}>{initError ?? 'Task not found'}</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/tasks')}>← Back to tasks</Button>
      </div>
    );
  }

  /* ─── LEFT PANEL ──────────────────────────────────────────────────────────── */
  const LeftPanel = (
    <div style={{
      width: 280, flexShrink: 0,
      background: 'var(--bg-surface)',
      borderRight: '1px solid var(--hairline)',
      overflowY: 'auto',
      padding: 20,
    }}>
      {/* Back */}
      <button
        onClick={() => navigate('/tasks')}
        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 20 }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--text-muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 11L5 7l4-4" />
        </svg>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>Sprint backlog</span>
      </button>

      {/* Task header */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <Badge variant="secondary">{SOURCE_LABELS[task.source] ?? task.source}</Badge>
        <Badge variant="secondary">{TYPE_LABELS[task.type] ?? task.type}</Badge>
      </div>
      <h2 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', margin: '8px 0', fontFamily: 'var(--font-sans)', lineHeight: 1.4 }}>{task.title}</h2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: (task.priority === 'critical' || task.priority === 'high') ? 'var(--accent-amber)' : 'var(--text-muted)', flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Priority {PRIORITY_LABELS[task.priority] ?? task.priority}</span>
      </div>

      <hr style={DIVIDER} />

      {/* Stack */}
      <span style={SECTION_LABEL}>Repository Stack</span>
      {stackProfile ? <StackBadge stackProfile={stackProfile} /> : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>No repo selected</span>}
      <p style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 6 }}>AI suggestions will target this stack</p>

      <hr style={DIVIDER} />

      {/* Description */}
      {task.description && (
        <>
          <span style={SECTION_LABEL}>Description</span>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 0 }}>{task.description}</p>
          <hr style={DIVIDER} />
        </>
      )}

      {/* AC */}
      {criteriaList.length > 0 && (
        <>
          <span style={SECTION_LABEL}>Acceptance Criteria</span>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {criteriaList.map((item, i) => (
              <div
                key={i}
                onClick={() => setCriteria((prev) => ({ ...prev, [i]: !prev[i] }))}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', cursor: 'pointer' }}
              >
                {criteria[i] ? (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: 2 }}>
                    <circle cx="8" cy="8" r="8" fill="var(--accent-green)" />
                    <path d="M4 8l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <span style={{ width: 16, height: 16, borderRadius: '50%', border: '1.5px solid var(--hairline-strong)', flexShrink: 0, marginTop: 2, display: 'inline-block' }} />
                )}
                <span style={{
                  fontSize: 12, color: criteria[i] ? 'var(--accent-green)' : 'var(--text-secondary)',
                  textDecoration: criteria[i] ? 'line-through' : 'none', lineHeight: 1.5,
                }}>
                  {item}
                </span>
              </div>
            ))}
          </div>
          <hr style={DIVIDER} />
        </>
      )}

      {/* Refine */}
      <span style={SECTION_LABEL}>Refine with AI</span>
      <textarea
        rows={4}
        value={refinementPrompt}
        onChange={(e) => setRefinementPrompt(e.target.value)}
        placeholder="Ask the agents to adjust the approach…"
        style={{
          width: '100%', background: 'var(--bg-raised)', border: '1px solid var(--hairline)', borderRadius: 'var(--radius-md)',
          color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-sans)', padding: 10, resize: 'vertical',
          outline: 'none', boxSizing: 'border-box',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-blue)'; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--hairline)'; }}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {['Add error handling', 'Add unit tests', 'Optimise performance', 'Add TypeScript types'].map((chip) => (
          <button
            key={chip}
            onClick={() => setRefinementPrompt((p) => p ? `${p} ${chip}` : chip)}
            style={{
              padding: '4px 10px', border: '1px solid var(--hairline)', borderRadius: 20,
              fontSize: 11, color: 'var(--text-muted)', background: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-sans)', transition: 'border-color 150ms, color 150ms',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent-blue)'; e.currentTarget.style.color = 'var(--accent-blue)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--hairline)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
          >{chip}</button>
        ))}
      </div>
      <div style={{ marginTop: 12 }}>
        <Button
          className="w-full"
          disabled={isGenerating}
          onClick={() => void doGenerate(refinementPrompt || undefined)}
        >
          {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SparkIcon />}
          Re-generate
        </Button>
      </div>
    </div>
  );

  /* ─── CENTRE PANEL ─────────────────────────────────────────────────────── */
  const CentrePanel = (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-app)', overflow: 'hidden', minWidth: 0 }}>
      {/* Agent tabs (top 60%) */}
      <div style={{ display: 'flex', flexDirection: 'column', height: '60%', minHeight: 0 }}>
        {/* Tab bar */}
        <div style={{ display: 'flex', background: 'var(--bg-surface)', borderBottom: '1px solid var(--hairline)', padding: '0 16px', overflowX: 'auto', flexShrink: 0 }}>
          {(isGenerating ? ['claude', 'openai'] : sortedSuggestions.map((s) => s.agent)).map((agentKey, idx) => {
            const meta = AGENT_META[agentKey];
            const suggestion = sortedSuggestions.find((s) => s.agent === agentKey);
            const isActive = agentKey === activeAgent;
            const isRec = suggestion?.recommendation === 'Recommended';
            const isBest = idx === 0 && !isGenerating;
            return (
              <button
                key={agentKey}
                data-testid={`tab-${agentKey}`}
                onClick={() => !isGenerating && setActiveAgent(agentKey)}
                style={{
                  padding: '12px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  background: 'transparent', border: 'none',
                  borderBottom: `2px solid ${isActive ? meta?.color ?? 'var(--accent-blue)' : 'transparent'}`,
                  color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                  display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
                  transition: 'color 150ms, border-color 150ms',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                {meta?.label ?? agentKey}
                {!isGenerating && suggestion?.score !== undefined && (
                  <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 'var(--radius-sm)', background: `${meta?.color ?? 'var(--accent-blue)'}22`, color: meta?.color ?? 'var(--accent-blue)' }}>
                    {suggestion.score.toFixed(1)}
                  </span>
                )}
                {isBest && !isGenerating && (
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 'var(--radius-sm)', background: 'rgba(61,214,140,0.15)', color: 'var(--accent-green)' }}>Best</span>
                )}
                {isGenerating && (
                  <LoadingDots color={meta?.color ?? 'var(--text-muted)'} />
                )}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {isGenerating ? (
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-48 w-full" />
              <Skeleton className="h-4 w-2/5" />
            </div>
          ) : activeSuggestion ? (
            <>
              {/* Explanation banner */}
              <p style={{ fontStyle: 'italic', fontSize: 12, color: 'var(--text-secondary)', background: 'var(--bg-raised)', padding: '10px 16px', borderBottom: '1px solid var(--hairline)', margin: 0 }}>
                {activeSuggestion.explanation}
              </p>

              {/* File path bar */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', borderBottom: '1px solid var(--hairline)' }}>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{(activeSuggestion.files[0]?.filePath ?? '')}</span>
                <button
                  onClick={() => void copyToClipboard((activeSuggestion.files[0]?.filePath ?? ''), 'path')}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: copyFeedback === 'path' ? 'var(--accent-green)' : 'var(--text-muted)', padding: 4 }}
                  title={copyFeedback === 'path' ? 'Copied!' : 'Copy path'}
                >
                  <CopyIcon />
                </button>
              </div>

              {/* Code block */}
              <div style={{ flex: 1, position: 'relative', overflowY: 'auto' }}>
                <button
                  onClick={() => void copyToClipboard((activeSuggestion.files[0]?.content ?? ''), 'code')}
                  style={{ position: 'absolute', top: 8, right: 8, zIndex: 10, background: 'var(--bg-raised)', border: '1px solid var(--hairline)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', color: copyFeedback === 'code' ? 'var(--accent-green)' : 'var(--text-muted)', padding: '4px 6px', display: 'flex', alignItems: 'center', gap: 4 }}
                  title={copyFeedback === 'code' ? 'Copied!' : 'Copy code'}
                >
                  <CopyIcon />
                  <span style={{ fontSize: 11 }}>{copyFeedback === 'code' ? 'Copied!' : 'Copy'}</span>
                </button>
                <SyntaxHighlighter
                  language={langFromPath((activeSuggestion.files[0]?.filePath ?? ''))}
                  customStyle={CODE_STYLE}
                  showLineNumbers
                  wrapLongLines={false}
                >
                  {(activeSuggestion.files[0]?.content ?? '')}
                </SyntaxHighlighter>
              </div>

              {/* Score bars */}
              <div style={{ padding: 16, borderTop: '1px solid var(--hairline)', flexShrink: 0 }}>
                {[
                  { label: 'Correctness', score: activeSuggestion.score },
                  { label: 'Readability', score: activeSuggestion.score ? activeSuggestion.score * 0.95 : undefined },
                  { label: 'Minimal diff', score: activeSuggestion.score ? activeSuggestion.score * 0.88 : undefined },
                  { label: 'Conventions', score: activeSuggestion.score ? activeSuggestion.score * 0.92 : undefined },
                ].map(({ label, score }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', width: 140, flexShrink: 0 }}>{label}</span>
                    <div style={{ flex: 1, height: 4, background: 'var(--bg-raised)', borderRadius: 2 }}>
                      <div style={{ width: `${(score ?? 0) * 10}%`, height: '100%', background: 'var(--accent-blue)', borderRadius: 2, transition: 'width 600ms ease' }} />
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 36, textAlign: 'right' }}>
                      {score !== undefined ? `${Math.round(score * 10)}%` : '—'}
                    </span>
                  </div>
                ))}
              </div>

              {/* Accept button */}
              <div style={{ padding: 16, borderTop: '1px solid var(--hairline)', flexShrink: 0 }}>
                <Button
                  data-testid={`btn-accept-${activeSuggestion.agent}`}
                  className="w-full"
                  disabled={acceptedSuggestion?.agent === activeSuggestion.agent}
                  onClick={() => { setAcceptedSuggestion(activeSuggestion); setCurrentStep(2); }}
                >
                  {acceptedSuggestion?.agent === activeSuggestion.agent ? '✓ Accepted' : 'Accept this suggestion'}
                </Button>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No suggestions loaded.</p>
            </div>
          )}
        </div>
      </div>

      {/* Diff view (bottom 40%) */}
      <div style={{ height: '40%', borderTop: '1px solid var(--hairline)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--hairline)', flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>Changes</span>
          <span style={{ fontSize: 11 }}>
            <span style={{ color: 'var(--accent-green)' }}>+14</span>
            <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>/</span>
            <span style={{ color: 'var(--accent-red)' }}>-3</span>
          </span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {!acceptedSuggestion ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 24 }}>Select a suggestion to see the diff</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, height: '100%' }}>
              {(['Current', 'Suggested'] as const).map((side) => (
                <div key={side}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{side}</div>
                  <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', background: 'var(--bg-raised)', borderRadius: 'var(--radius-sm)', padding: 12 }}>
                    {side === 'Suggested' ? (
                      <div style={{ borderLeft: '3px solid var(--accent-green)', background: 'rgba(61,214,140,0.08)', paddingLeft: 4 }}>
                        {(acceptedSuggestion.files[0]?.content ?? '').split('\n').slice(0, 8).join('\n')}
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>// No existing file</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  /* ─── RIGHT PANEL ──────────────────────────────────────────────────────── */
  const RightPanel = isComplete ? (
    <div style={{
      width: 280, flexShrink: 0, background: 'var(--bg-surface)', borderLeft: '1px solid var(--hairline)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', textAlign: 'center', padding: 20,
    }}>
      <SuccessCircle />
      <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-green)', marginTop: 16 }}>Task closed</p>
      <p style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginTop: 4 }}>
        {task.externalId ?? `TASK-${task.id}`}
      </p>
      <div style={{ marginTop: 20 }}>
        <Button variant="outline" size="sm" onClick={() => navigate('/tasks')}>Back to backlog</Button>
      </div>
    </div>
  ) : (
    <div style={{
      width: 280, flexShrink: 0, background: 'var(--bg-surface)',
      borderLeft: '1px solid var(--hairline)', overflowY: 'auto', padding: 20,
    }}>
      <Stepper currentStep={currentStep} />

      <hr style={DIVIDER} />

      {/* Accepted suggestion card */}
      <span style={SECTION_LABEL}>Accepted Suggestion</span>
      {!acceptedSuggestion ? (
        <div style={{ border: '1px dashed var(--hairline)', borderRadius: 'var(--radius-md)', padding: 12, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
          No suggestion accepted yet
        </div>
      ) : (
        <div style={{ background: 'var(--bg-raised)', border: '1px solid var(--hairline)', borderRadius: 'var(--radius-md)', padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: AGENT_META[acceptedSuggestion.agent]?.color ?? 'var(--accent-blue)', marginBottom: 4 }}>
            {AGENT_META[acceptedSuggestion.agent]?.label ?? acceptedSuggestion.agent}
          </div>
          {acceptedSuggestion.score !== undefined && (
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
              {acceptedSuggestion.score.toFixed(1)} / 10
            </div>
          )}
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {(acceptedSuggestion.files[0]?.filePath ?? '')}
          </div>
        </div>
      )}

      <hr style={DIVIDER} />

      {/* Commit section */}
      <span style={SECTION_LABEL}>Commit Details</span>
      <input
        readOnly
        value={`task/${taskId}`}
        style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--bg-raised)', border: '1px solid var(--hairline)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--text-primary)', cursor: 'default', boxSizing: 'border-box' }}
      />
      <input
        value={commitMessage}
        onChange={(e) => setCommitMessage(e.target.value)}
        style={{ width: '100%', fontFamily: 'var(--font-sans)', fontSize: 12, background: 'var(--bg-raised)', border: '1px solid var(--hairline)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--text-primary)', cursor: 'text', boxSizing: 'border-box', marginTop: 8, outline: 'none' }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-blue)'; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--hairline)'; }}
      />
      <div style={{ marginTop: 12 }}>
        <Button
          className="w-full"
          disabled={!acceptedSuggestion || isCommitting}
          onClick={() => void handleCommit()}
          data-testid="btn-commit"
        >
          {isCommitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Commit + open PR
        </Button>
      </div>
      {prUrl && (
        <a href={prUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'block', marginTop: 8, fontSize: 11, color: 'var(--accent-blue)', wordBreak: 'break-all' }}>
          {prUrl}
        </a>
      )}

      <hr style={DIVIDER} />

      {/* Complete task section */}
      <span style={SECTION_LABEL}>Complete Task</span>
      <Button
        className="w-full"
        disabled={!prUrl || isCompleting}
        onClick={() => setConfirmDialogOpen(true)}
        style={{ background: 'var(--accent-green)', color: '#0D0F12' }}
        data-testid="btn-mark-complete"
      >
        {isCompleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Mark task complete
      </Button>

      {confirmDialogOpen && (
        <div style={{ background: 'var(--bg-raised)', border: '1px solid var(--hairline-strong)', borderRadius: 'var(--radius-md)', padding: 14, marginTop: 8 }}>
          <p style={{ fontSize: 12, color: 'var(--text-primary)', marginBottom: 10 }}>
            Close this task in {SOURCE_LABELS[task.source] ?? task.source}?
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              size="sm"
              className="flex-1"
              disabled={isCompleting}
              onClick={() => void handleComplete()}
              style={{ background: 'var(--accent-green)', color: '#0D0F12' }}
            >
              Confirm
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => setConfirmDialogOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  /* ─── Shortcuts panel ─────────────────────────────────────────────────── */
  const ShortcutsPanel = shortcutsOpen && (
    <div
      style={{ position: 'fixed', bottom: 24, left: 24, zIndex: 200, background: 'var(--bg-surface)', border: '1px solid var(--hairline)', borderRadius: 'var(--radius-lg)', padding: 16, width: 260 }}
      onClick={(e) => e.stopPropagation()}
    >
      <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Keyboard shortcuts</p>
      {[
        { key: 'R', desc: 'Re-generate suggestions' },
        { key: 'Ctrl+↵', desc: 'Commit accepted code' },
        { key: '?', desc: 'Toggle this panel' },
        { key: 'Esc', desc: 'Close dialogs' },
      ].map(({ key, desc }) => (
        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', background: 'var(--bg-raised)', border: '1px solid var(--hairline)', borderRadius: 4, padding: '2px 6px', color: 'var(--text-secondary)', flexShrink: 0 }}>{key}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{desc}</span>
        </div>
      ))}
    </div>
  );

  /* ─── Mobile banner ───────────────────────────────────────────────────── */
  const MobileBanner = !mobileBannerDismissed && (
    <div style={{ background: 'var(--bg-raised)', borderBottom: '1px solid var(--hairline)', borderLeft: '3px solid var(--accent-amber)', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }} className="dc-mobile-banner">
      <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>Kandryn works best on a wider screen</span>
      <button onClick={() => setMobileBannerDismissed(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, lineHeight: 1 }}>×</button>
    </div>
  );

  return (
    <>
      <style>{`
        @media (max-width: 768px) {
          .dc-workspace { flex-direction: column !important; }
          .dc-mobile-banner { display: flex !important; }
          .dc-workspace-tabs { display: flex !important; }
          .dc-left-panel, .dc-centre-panel, .dc-right-panel { display: none; }
        }
        @media (min-width: 769px) {
          .dc-mobile-banner { display: none !important; }
          .dc-workspace-tabs { display: none !important; }
          .dc-left-panel, .dc-centre-panel, .dc-right-panel { display: flex !important; }
        }
        @media (max-width: 1200px) and (min-width: 769px) {
          .dc-workspace { flex-direction: column !important; }
          .dc-left-panel { width: 100% !important; max-height: 400px; }
          .dc-right-panel { width: 100% !important; max-height: 400px; }
        }
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {MobileBanner}

        {/* Mobile tabs */}
        <div className="dc-workspace-tabs" style={{ display: 'none', background: 'var(--bg-surface)', borderBottom: '1px solid var(--hairline)', padding: '0 16px' }}>
          {(['task', 'suggestions', 'actions'] as const).map((tab) => (
            <button key={tab} onClick={() => setMobileTab(tab)} style={{ padding: '12px 16px', fontSize: 12, fontWeight: 600, background: 'transparent', border: 'none', borderBottom: `2px solid ${mobileTab === tab ? 'var(--accent-blue)' : 'transparent'}`, color: mobileTab === tab ? 'var(--text-primary)' : 'var(--text-muted)', cursor: 'pointer', textTransform: 'capitalize', fontFamily: 'var(--font-sans)' }}>
              {tab === 'task' ? 'Task' : tab === 'suggestions' ? 'Suggestions' : 'Actions'}
            </button>
          ))}
        </div>

        {/* Main content */}
        <div className="dc-workspace" style={{ flex: 1, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
          <div className="dc-left-panel" style={{ display: 'flex', flexDirection: 'column', width: 280 }}>
            {LeftPanel}
          </div>
          <div className="dc-centre-panel" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            {CentrePanel}
          </div>
          <div className="dc-right-panel" style={{ display: 'flex', flexDirection: 'column', width: 280 }}>
            {RightPanel}
          </div>
        </div>
      </div>

      {ShortcutsPanel}
    </>
  );
}
