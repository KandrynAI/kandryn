import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Trust & Security',
  description:
    'Security controls, data handling, compliance status, and sub-processor list for Blue Mantis enterprise customers.',
  alternates: { canonical: '/trust/' },
};

/* ── Local status colours (semantic, not brand palette) ───────────────────────
   green = live/verifiable · amber = in progress · grey = planned.
   A single semantic red is used only for HIGH data-sensitivity badges. */
const STATUS: Record<'green' | 'amber' | 'grey', string> = {
  green: '#1a7f4b',
  amber: '#d4821a',
  grey: '#8a9ab0',
};

function Dot({ tone }: { tone: 'green' | 'amber' | 'grey' }) {
  return (
    <span
      aria-hidden
      style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: STATUS[tone] }}
    />
  );
}

function StatusBadge({ label, tone }: { label: string; tone: 'green' | 'amber' | 'grey' }) {
  return (
    <span className="tag" style={{ background: STATUS[tone], color: '#ffffff' }}>
      {label}
    </span>
  );
}

function SensBadge({ level }: { level: string }) {
  const map: Record<string, string> = {
    HIGH: '#b23a2f',
    MEDIUM: '#d4821a',
    LOW: '#8a9ab0',
    'LOW–MEDIUM': '#d4821a',
  };
  return (
    <span className="tag" style={{ background: map[level] ?? '#8a9ab0', color: '#ffffff', whiteSpace: 'nowrap' }}>
      {level}
    </span>
  );
}

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <div className="kicker" style={{ marginBottom: 16 }}>
      {children}
    </div>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontSize: 30, fontWeight: 900, letterSpacing: '-0.02em', lineHeight: 1.05 }}>{children}</h2>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 17, lineHeight: 1.55, color: 'var(--color-neutral-800)', maxWidth: 760, marginTop: 16, textWrap: 'pretty' }}>
      {children}
    </p>
  );
}

const sectionStyle: React.CSSProperties = { padding: '56px 64px', borderBottom: '2px solid var(--color-divider)' };
const cellBox: React.CSSProperties = {
  borderRight: '2px solid var(--color-divider)',
  borderBottom: '2px solid var(--color-divider)',
  padding: '28px 32px',
};

// ── Section 1 data ───────────────────────────────────────────────────────────
type TrustRow = { tone: 'green' | 'amber' | 'grey'; control: string; status: string; anchor: string; link: string };
const TRUST_ROWS: TrustRow[] = [
  { tone: 'green', control: 'Data isolation', status: 'All queries scoped per-user. No cross-tenant reads possible.', anchor: '#access-control', link: 'Access control' },
  { tone: 'green', control: 'Encryption in transit', status: 'TLS 1.2+ enforced on all API and database connections.', anchor: '#infrastructure', link: 'Infrastructure' },
  { tone: 'green', control: 'Encryption at rest', status: 'AES-256 via AWS RDS (Supabase). All database storage encrypted.', anchor: '#infrastructure', link: 'Infrastructure' },
  { tone: 'green', control: 'Audit log', status: 'Full action log. Admin-only. 30–365 days by plan. CSV export.', anchor: '#audit-log', link: 'Audit log' },
  { tone: 'green', control: 'AI model transparency', status: 'Named models disclosed. Customer API keys. No training on your data.', anchor: '#ai-and-models', link: 'AI and models' },
  { tone: 'green', control: 'Human-approved commits', status: 'No commit without an explicit click. Optional auto-commit is off by default; Blue Mantis never merges.', anchor: '#ai-and-models', link: 'AI and models' },
  { tone: 'green', control: 'Security scanning', status: 'Aegis scans every committed change for OWASP Top 10.', anchor: '#ai-and-models', link: 'AI and models' },
  { tone: 'green', control: 'Sub-processor list', status: 'All processors named with data category and region.', anchor: '#sub-processors', link: 'Sub-processors' },
  { tone: 'green', control: 'US data residency', status: 'All storage and processing in US East (AWS us-east-1).', anchor: '#infrastructure', link: 'Infrastructure' },
  { tone: 'amber', control: 'SSO / SAML', status: 'In progress. Target: Q4 2026. Okta and Azure AD.', anchor: '#access-control', link: 'Access control' },
  { tone: 'amber', control: 'MFA enforcement', status: 'Available via Clerk. Enforcement for Enterprise: Q4 2026.', anchor: '#access-control', link: 'Access control' },
  { tone: 'amber', control: 'Penetration test', status: 'Scheduled. Target completion: Q4 2026.', anchor: '#compliance', link: 'Compliance' },
  { tone: 'amber', control: 'Data retention policy', status: 'Documented. Automated purge: in progress.', anchor: '#data-handling', link: 'Data handling' },
  { tone: 'grey', control: 'SOC 2 Type II', status: 'In progress. Observation period begins Q4 2026.', anchor: '#compliance', link: 'Compliance' },
  { tone: 'grey', control: 'ISO 27001', status: 'Planned. EU expansion phase.', anchor: '#compliance', link: 'Compliance' },
];

// ── Section 2 data ───────────────────────────────────────────────────────────
type DataCard = { title: string; sens: string; rows: [string, React.ReactNode][] };
const DATA_CARDS: DataCard[] = [
  {
    title: 'Work item content',
    sens: 'LOW–MEDIUM',
    rows: [
      ['What', 'Work item titles, descriptions, acceptance criteria'],
      ['Source', 'Jira / Azure DevOps'],
      ['Stored by BM', 'Metadata only (title, status, AC count)'],
      ['Sent to AI', 'Yes — included in the case file per run'],
    ],
  },
  {
    title: 'Source code (selected files)',
    sens: 'HIGH',
    rows: [
      ['What', 'Up to 8 source-code file sections per run — 5 via keyword extraction, 8 via the Graphify knowledge graph — selected by relevance to the work item'],
      ['Source', 'GitHub / Azure Repos'],
      ['Stored by BM', <><strong>Not stored.</strong> Read at run time, sent to agents, discarded.</>],
      ['Sent to AI', 'Yes — the file sections selected for the run'],
    ],
  },
  {
    title: 'Run metadata',
    sens: 'LOW',
    rows: [
      ['What', 'Run status, timestamps, agent scores, PR URLs, commit hashes, Synthesia scores, Aegis findings (structured, not raw code)'],
      ['Source', 'Generated by Blue Mantis'],
      ['Stored by BM', 'Yes — in Supabase PostgreSQL'],
      ['Sent to AI', 'No'],
    ],
  },
  {
    title: 'Credentials',
    sens: 'HIGH',
    rows: [
      ['What', 'API tokens for Jira, GitHub, Azure DevOps, Confluence, Notion'],
      ['Source', 'User-provided'],
      ['Stored by BM', 'Yes — per-user, in Supabase. TLS in transit.'],
      ['Sent to AI', <><strong>Never.</strong> Credentials are never included in any AI prompt.</>],
      ['Logged', <><strong>Never.</strong> Credential values are never written to any log.</>],
    ],
  },
  {
    title: 'User accounts',
    sens: 'MEDIUM',
    rows: [
      ['What', 'Email address, name, OAuth identity'],
      ['Source', 'Sign-up'],
      ['Stored by BM', 'Via Clerk (authentication provider)'],
      ['Sent to AI', 'No'],
    ],
  },
  {
    title: 'Audit log',
    sens: 'MEDIUM',
    rows: [
      ['What', 'Action names, timestamps, IP addresses, entity IDs'],
      ['Source', 'Generated by Blue Mantis'],
      ['Stored by BM', 'Yes — 30–365 days depending on plan'],
      ['Sent to AI', 'No'],
    ],
  },
];

// ── Section 3 data ───────────────────────────────────────────────────────────
const MODEL_ROWS = [
  ['Raptia', 'claude-sonnet-4-5', 'Anthropic', 'Code generation', 'Work item + selected code files + stack profile'],
  ['Fovea', 'gpt-4o', 'OpenAI', 'Code generation', 'Same case file as Raptia — run in parallel'],
  ['Synthesia', 'claude-sonnet-4-5', 'Anthropic', 'Ranking', 'Both suggestions + AC + stack profile'],
  ['Veria', 'claude-sonnet-4-5', 'Anthropic', 'Code review', 'Committed code + acceptance criteria'],
  ['Aegis', 'claude-fable-5', 'Anthropic', 'Security scanning', 'Committed file only — no other repo context'],
];

// ── Section 5 data ───────────────────────────────────────────────────────────
const INFRA_ROWS = [
  ['Application hosting', 'Vercel', 'US East (AWS/CF)', 'SOC 2 Type II', 'All application traffic'],
  ['Database', 'Supabase', 'AWS us-east-1', 'SOC 2 Type II', 'All stored data'],
  ['Authentication', 'Clerk', 'US', 'SOC 2 Type II', 'User accounts + sessions'],
  ['Email', 'Resend', 'US', 'SOC 2 Type II', 'Run notifications'],
  ['Graphify microservice', 'Railway', 'US', '—', 'Repository clone at index time (discarded)'],
  ['AI inference (primary)', 'Anthropic', 'US', '—', 'Code + work item content'],
  ['AI inference (secondary)', 'OpenAI', 'US', 'SOC 2 Type II', 'Code + work item content'],
];

// ── Section 6 data ───────────────────────────────────────────────────────────
const AUDIT_EVENTS = [
  'User sign-in and sign-out',
  'Credential saved or deleted (key name only, never value)',
  'Team credential saved or deleted',
  'Project created or deleted',
  'Repository connected or removed',
  'Board sync triggered',
  'Run triggered or scheduled',
  'Suggestion committed (agent name + score recorded)',
  'Run canceled or failed',
  'Aegis security scan completed (gate decision + finding counts)',
  'Security finding pushed to tracker',
  'Remediation run started',
  'Narratia runbook generated and pushed',
  'Team member invited, joined, removed, or role changed',
  'Tests committed or pushed to PLM',
];

// ── Section 7 data ───────────────────────────────────────────────────────────
const SUBPROC_ROWS = [
  ['Supabase (PostgreSQL)', 'Database', 'Work items, runs, scores, credentials (encrypted at rest)', 'US East', 'SOC 2 Type II'],
  ['Clerk', 'Authentication', 'Email, name, OAuth identity, session tokens', 'US', 'SOC 2 Type II'],
  ['Anthropic', 'AI inference', 'Work item content + selected code file sections', 'US', 'Enterprise DPA available'],
  ['OpenAI', 'AI inference', 'Work item content + selected code file sections', 'US', 'SOC 2 Type II · Enterprise DPA'],
  ['Vercel', 'Application hosting', 'All application traffic (no persistent storage)', 'US', 'SOC 2 Type II'],
  ['Resend', 'Email', 'Email address + run outcome summary', 'US', 'SOC 2 Type II'],
  ['Railway', 'Graphify service', 'Repository clone at index time (no persistent storage)', 'US', '—'],
];

export default function TrustPage() {
  return (
    <>
      {/* ═══ SECTION 1 — TRUST STATUS ═══════════════════════════════════════ */}
      <header className="pad-x" style={{ padding: '64px 64px 40px', borderBottom: '2px solid var(--color-divider)' }}>
        <h1 className="h1-inner" style={{ fontSize: 56, fontWeight: 900, letterSpacing: '-0.035em', lineHeight: 0.98 }}>
          Security controls,
          <br />
          stated plainly.
        </h1>
        <p style={{ fontSize: 18, lineHeight: 1.5, color: 'var(--color-neutral-800)', marginTop: 22, maxWidth: 760, textWrap: 'pretty' }}>
          For security teams conducting vendor assessments. Everything Blue Mantis holds, touches, and refuses to do —
          with honest status on what is live, what is in progress, and what is not yet built.
        </p>
        <p style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 18 }}>
          Last reviewed: August 2026
        </p>
      </header>

      <section style={{ ...sectionStyle }} className="pad-x">
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 680 }}>
            {TRUST_ROWS.map((r) => (
              <div
                key={r.control}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '20px 220px 1fr 150px',
                  alignItems: 'center',
                  gap: 16,
                  padding: '13px 0',
                  borderBottom: '1px solid var(--color-neutral-300)',
                }}
              >
                <Dot tone={r.tone} />
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--color-text)' }}>{r.control}</div>
                <div style={{ fontSize: 14, color: 'var(--color-neutral-800)', lineHeight: 1.45 }}>{r.status}</div>
                <a href={r.anchor} style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-accent)', whiteSpace: 'nowrap' }}>
                  ↓ {r.link}
                </a>
              </div>
            ))}
          </div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 16, lineHeight: 1.5 }}>
          Green = live and verifiable · Amber = in progress with target date · Grey = planned. We update this table when
          status changes.
        </p>
      </section>

      {/* ═══ SECTION 2 — DATA HANDLING ══════════════════════════════════════ */}
      <section id="data-handling" style={sectionStyle} className="pad-x">
        <Kicker>Data handling</Kicker>
        <H2>
          What Blue Mantis
          <br />
          processes on your behalf.
        </H2>
        <div
          className="grid-3 stack-1"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', borderLeft: '2px solid var(--color-divider)', borderTop: '2px solid var(--color-divider)', marginTop: 28 }}
        >
          {DATA_CARDS.map((card) => (
            <div key={card.title} style={cellBox}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.01em' }}>{card.title}</div>
                <SensBadge level={card.sens} />
              </div>
              <dl style={{ marginTop: 14, display: 'grid', gap: 10 }}>
                {card.rows.map(([k, v]) => (
                  <div key={k}>
                    <dt style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-neutral-600)' }}>
                      {k}
                    </dt>
                    <dd style={{ margin: '3px 0 0', fontSize: 14, lineHeight: 1.5, color: 'var(--color-neutral-800)' }}>{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 32, borderLeft: '2px solid var(--color-accent)', padding: '16px 20px', background: 'var(--color-accent-100)' }}>
          <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-accent-700)', marginBottom: 8 }}>
            What Blue Mantis never processes
          </div>
          <p style={{ fontSize: 15, lineHeight: 1.55, color: 'var(--color-text)', margin: 0, maxWidth: 820 }}>
            Blue Mantis does not process end-user PII, financial records, healthcare data, production database contents,
            or any data outside the software development workflow. It never reads repository secrets, environment
            variables, or GitHub Actions secrets.
          </p>
        </div>
      </section>

      {/* ═══ SECTION 3 — AI AND MODELS ══════════════════════════════════════ */}
      <section id="ai-and-models" style={sectionStyle} className="pad-x">
        <Kicker>AI and models</Kicker>
        <H2>
          Which models run.
          <br />
          What they see. What they never touch.
        </H2>
        <Sub>
          Blue Mantis is an AI orchestration layer, not an AI model. We use established model providers via their
          enterprise APIs. Here is exactly what runs and why.
        </Sub>

        <div style={{ overflowX: 'auto', marginTop: 28 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Model</th>
                <th>Provider</th>
                <th>Purpose</th>
                <th>What it receives</th>
              </tr>
            </thead>
            <tbody>
              {MODEL_ROWS.map((row) => (
                <tr key={row[0]}>
                  <td style={{ fontWeight: 700, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>{row[0]}</td>
                  <td style={{ fontFamily: 'var(--font-mono), monospace', whiteSpace: 'nowrap' }}>{row[1]}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{row[2]}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{row[3]}</td>
                  <td>{row[4]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid-3 stack-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24, marginTop: 36 }}>
          {[
            {
              t: 'No training on your data',
              b: "Blue Mantis does not train any AI model. All inference calls are made via the Anthropic and OpenAI enterprise APIs. Under enterprise API terms, customer data is not used for model training — Anthropic's API offers zero-data-retention terms for enterprise customers.",
            },
            {
              t: 'Your keys, your quota',
              b: 'Every API call is made using the customer’s own Anthropic and OpenAI API keys, stored per-user and never shared. You see the usage in your own Anthropic/OpenAI dashboards. Blue Mantis does not proxy or aggregate model costs.',
            },
            {
              t: 'Model change notice',
              b: 'If Blue Mantis changes the model used for any agent that affects code-generation output, customers receive 30 days’ written notice before the change takes effect. The model version used is recorded on every run record.',
            },
          ].map((blk) => (
            <div key={blk.t}>
              <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.01em' }}>{blk.t}</div>
              <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--color-neutral-800)', marginTop: 10 }}>{blk.b}</p>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 36, borderLeft: '2px solid var(--color-accent)', padding: '18px 22px', background: 'var(--color-accent-100)' }}>
          <p style={{ fontSize: 16, lineHeight: 1.55, color: 'var(--color-text)', margin: 0, maxWidth: 860 }}>
            By default, no code is committed to your repository without explicit developer action. Blue Mantis presents
            two competing suggestions and a ranked recommendation; the developer chooses which to commit, then clicks. An
            optional per-run auto-commit setting — off by default — commits the top-ranked suggestion automatically only
            when you enable it. Blue Mantis never merges and never force-pushes.
          </p>
        </div>
      </section>

      {/* ═══ SECTION 4 — ACCESS CONTROL ═════════════════════════════════════ */}
      <section id="access-control" style={sectionStyle} className="pad-x">
        <Kicker>Access control</Kicker>
        <H2>
          Who can reach what,
          <br />
          and how it is enforced.
        </H2>
        <div className="grid-3 stack-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 32, marginTop: 28 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Authentication (today)</div>
            <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--color-neutral-800)', marginTop: 10 }}>
              Email / password or OAuth via Clerk. MFA available (TOTP). MFA enforcement for the Enterprise plan: Q4 2026.
              Session management: Clerk-managed, with token expiry and refresh.
            </p>
            <div style={{ marginTop: 14 }}>
              <StatusBadge label="IN PROGRESS" tone="amber" />
              <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--color-neutral-800)', marginTop: 10 }}>
                SSO / SAML 2.0 — Okta, Azure AD, Google Workspace. Target: Q4 2026.
              </p>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Authorisation</div>
            <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--color-neutral-800)', marginTop: 10 }}>
              Every API endpoint requires authentication. Every database query is scoped to the authenticated user&rsquo;s
              ID. Team admins see team data; members see their own runs. No endpoint accepts a userId parameter from the
              request body — it is always derived server-side from the authenticated session.
            </p>
            <pre
              style={{
                marginTop: 12,
                background: 'var(--color-text)',
                color: '#e6ecf5',
                padding: '14px 16px',
                fontSize: 12,
                lineHeight: 1.55,
                overflowX: 'auto',
              }}
            >
{`// Every run query — representative example
where: and(
  eq(runs.userId, req.userId),  // always server-set
  eq(runs.projectId, projectId)
)`}
            </pre>
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Staff access</div>
            <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--color-neutral-800)', marginTop: 10 }}>
              Two named individuals (co-founders) have Supabase database access, protected by MFA. No other staff have
              database access. There is no Blue Mantis admin UI for viewing customer data. Supabase infrastructure access
              logs are maintained by Supabase (SOC 2 Type II certified).
            </p>
          </div>
        </div>
      </section>

      {/* ═══ SECTION 5 — INFRASTRUCTURE ═════════════════════════════════════ */}
      <section id="infrastructure" style={sectionStyle} className="pad-x">
        <Kicker>Infrastructure</Kicker>
        <H2>Where every byte lives.</H2>
        <Sub>
          All primary storage and processing is in the United States. No data is transferred to or stored in EU regions.
        </Sub>
        <div style={{ overflowX: 'auto', marginTop: 28 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Component</th>
                <th>Provider</th>
                <th>Region</th>
                <th>Certification</th>
                <th>Data category</th>
              </tr>
            </thead>
            <tbody>
              {INFRA_ROWS.map((row) => (
                <tr key={row[0]}>
                  <td style={{ fontWeight: 700, color: 'var(--color-text)' }}>{row[0]}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{row[1]}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{row[2]}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{row[3]}</td>
                  <td>{row[4]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--color-neutral-800)', marginTop: 20, maxWidth: 820 }}>
          The Graphify microservice clones the repository to a temporary directory, extracts the knowledge graph, and
          discards the checkout — it has no persistent storage. Blue Mantis stores only the resulting graph (file paths
          and symbol names), never file contents, and no code content is stored outside Supabase.
        </p>
        <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--color-neutral-800)', marginTop: 12, maxWidth: 820 }}>
          <strong>EU customers (future):</strong> EU data residency is on our roadmap for 2027. Customers requiring EU
          storage should contact us to discuss timeline.
        </p>
      </section>

      {/* ═══ SECTION 6 — AUDIT LOG ══════════════════════════════════════════ */}
      <section id="audit-log" style={sectionStyle} className="pad-x">
        <Kicker>Audit log</Kicker>
        <H2>
          Every significant action,
          <br />
          recorded. Admin-only.
        </H2>
        <div className="grid-2 stack-1" style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 40, marginTop: 28 }}>
          <div>
            <p style={{ fontSize: 15, lineHeight: 1.55, color: 'var(--color-neutral-800)' }}>
              The audit log records all of the following with timestamp, user ID, IP address, and relevant metadata:
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', columnGap: 24, rowGap: 2, marginTop: 16 }}>
              {AUDIT_EVENTS.map((e) => (
                <div key={e} style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--color-neutral-800)', padding: '6px 0', borderBottom: '1px solid var(--color-neutral-200)' }}>
                  <span style={{ color: 'var(--color-accent)', marginRight: 8 }}>—</span>
                  {e}
                </div>
              ))}
            </div>
          </div>
          <div>
            <dl style={{ display: 'grid', gap: 12 }}>
              {[
                ['Who can access', 'Team admins only'],
                ['Where', 'Settings → Audit log'],
                ['Formats', 'In-app filterable view + CSV export'],
                ['Filters', 'Action type, team member, date range'],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-neutral-600)' }}>{k}</dt>
                  <dd style={{ margin: '2px 0 0', fontSize: 14, color: 'var(--color-neutral-800)' }}>{v}</dd>
                </div>
              ))}
            </dl>
            <div style={{ marginTop: 18, fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-neutral-600)' }}>
              Retention by plan
            </div>
            <div style={{ marginTop: 8 }}>
              {[
                ['Free', '30 days'],
                ['Pro / Max', '90 days'],
                ['Enterprise', '365 days'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '6px 0', borderBottom: '1px solid var(--color-neutral-200)' }}>
                  <span style={{ color: 'var(--color-neutral-800)' }}>{k}</span>
                  <span style={{ fontFamily: 'var(--font-mono), monospace', color: 'var(--color-text)' }}>{v}</span>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--color-neutral-700)', marginTop: 16 }}>
              Credential values are never logged — only key names. Audit rows are immutable. There is no delete or update
              endpoint for audit log entries.
            </p>
          </div>
        </div>
      </section>

      {/* ═══ SECTION 7 — SUB-PROCESSORS ═════════════════════════════════════ */}
      <section id="sub-processors" style={sectionStyle} className="pad-x">
        <Kicker>Sub-processors</Kicker>
        <H2>
          Every third party
          <br />
          that touches your data.
        </H2>
        <Sub>Blue Mantis does not sell data to any third party. Sub-processors are used only to deliver the product.</Sub>
        <div style={{ overflowX: 'auto', marginTop: 28 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Purpose</th>
                <th>Data received</th>
                <th>Location</th>
                <th>Their certification</th>
              </tr>
            </thead>
            <tbody>
              {SUBPROC_ROWS.map((row) => (
                <tr key={row[0]}>
                  <td style={{ fontWeight: 700, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>{row[0]}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{row[1]}</td>
                  <td>{row[2]}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{row[3]}</td>
                  <td>{row[4]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--color-neutral-800)', marginTop: 20, maxWidth: 820 }}>
          Credentials (Jira tokens, GitHub PATs, Azure DevOps tokens) are stored in Supabase only. They are never sent to
          Anthropic, OpenAI, Resend, Railway, or any other sub-processor.
        </p>
        <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--color-neutral-700)', marginTop: 12 }}>
          Last updated: August 2026. We notify customers of material sub-processor changes with 30 days&rsquo; notice.
        </p>
        <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--color-neutral-800)', marginTop: 12 }}>
          Questions about sub-processors or to request a copy of our DPA:{' '}
          <a href="mailto:security@getbluemantis.com" style={{ color: 'var(--color-accent)', fontWeight: 700 }}>
            security@getbluemantis.com
          </a>
        </p>
      </section>

      {/* ═══ SECTION 8 — COMPLIANCE STATUS ══════════════════════════════════ */}
      <section id="compliance" style={sectionStyle} className="pad-x">
        <Kicker>Compliance status</Kicker>
        <H2>
          Where we are.
          <br />
          Where we are going.
        </H2>
        <Sub>
          We do not claim certifications we do not have. Here is the honest status of each compliance programme.
        </Sub>
        <div
          className="grid-2 stack-1"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', borderLeft: '2px solid var(--color-divider)', borderTop: '2px solid var(--color-divider)', marginTop: 28 }}
        >
          {[
            { t: 'SOC 2 Type II', badge: ['IN PROGRESS', 'amber'] as const, b: 'We have engaged a compliance automation platform and begun the readiness assessment. The observation period for Type II certification begins Q4 2026. Expected completion: mid-2027. Enterprise customers can request our current security controls documentation as a bridge.' },
            { t: 'Penetration Test', badge: ['SCHEDULED', 'amber'] as const, b: 'An external penetration test of the Blue Mantis web application and API is scheduled for Q4 2026. We will publish the test scope, date, and findings summary upon completion.' },
            { t: 'CCPA (California)', badge: ['COMPLIANT', 'green'] as const, b: 'Blue Mantis does not process California consumer personal data (end-user PII). Developer accounts are covered under our privacy policy. Blue Mantis operates as a service provider under CCPA — data is processed on your behalf, not for our own commercial purposes.' },
            { t: 'ISO 27001', badge: ['PLANNED', 'grey'] as const, b: 'ISO 27001 certification is planned as part of our EU expansion programme. We will begin this process after SOC 2 Type II is complete.' },
          ].map((blk) => (
            <div key={blk.t} style={cellBox}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.01em' }}>{blk.t}</div>
                <StatusBadge label={blk.badge[0]} tone={blk.badge[1]} />
              </div>
              <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--color-neutral-800)', marginTop: 12 }}>{blk.b}</p>
            </div>
          ))}
        </div>

        {/* Security contact */}
        <div style={{ marginTop: 40, background: 'var(--color-accent)', color: '#ffffff', padding: '28px 32px' }}>
          <p style={{ fontSize: 16, lineHeight: 1.55, margin: 0 }}>
            Security questions, vulnerability reports, or to request our security controls documentation:
          </p>
          <a href="mailto:security@getbluemantis.com" style={{ display: 'inline-block', marginTop: 8, fontSize: 22, fontWeight: 800, color: '#ffffff' }}>
            security@getbluemantis.com
          </a>
          <p style={{ fontSize: 14, lineHeight: 1.55, marginTop: 10, color: 'var(--color-accent-200)' }}>
            We respond to security questions within 1 business day.
          </p>
          <p style={{ fontSize: 13, lineHeight: 1.55, marginTop: 14, color: 'var(--color-accent-200)', maxWidth: 720 }}>
            Found a vulnerability? Please disclose responsibly. We do not currently have a formal bug bounty programme,
            but we acknowledge and credit responsible disclosures.
          </p>
        </div>

        {/* Responsible disclosure */}
        <div style={{ marginTop: 24, borderLeft: '2px solid var(--color-divider)', padding: '16px 20px' }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-neutral-600)', marginBottom: 8 }}>
            Responsible disclosure
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--color-neutral-800)', margin: 0, maxWidth: 760 }}>
            To report a security vulnerability, email{' '}
            <a href="mailto:security@getbluemantis.com" style={{ color: 'var(--color-accent)', fontWeight: 700 }}>
              security@getbluemantis.com
            </a>{' '}
            with details. Please do not disclose publicly until we have had 90 days to investigate and remediate.
          </p>
        </div>
      </section>
    </>
  );
}
