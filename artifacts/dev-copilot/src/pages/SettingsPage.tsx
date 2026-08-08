import React, { useState } from "react";
import { useConfig, type ConfigMap } from "@/context/ConfigContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, Check, X, ExternalLink, ChevronDown, Loader2 } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Field {
  key: string;
  label: string;
  placeholder: string;
  hint?: string;
}

interface Integration {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  fields: Field[];
  steps: { label: string; link?: { text: string; url: string } }[];
  testKey: string;
}

// ─── Integrations definition ──────────────────────────────────────────────────

const INTEGRATIONS: Integration[] = [
  {
    id: "anthropic",
    title: "Agent A credentials",
    subtitle: "Used by Raptia",
    icon: <AnthropicIcon />,
    testKey: "anthropic",
    fields: [
      { key: "ANTHROPIC_API_KEY", label: "API key", placeholder: "sk-ant-api03-…", hint: "Starts with sk-ant-" },
    ],
    steps: [
      { label: "Go to console.anthropic.com and sign in" },
      { label: "Open API Keys from the left sidebar", link: { text: "Open console", url: "https://console.anthropic.com/account/keys" } },
      { label: "Click Create Key, copy the value, paste it below" },
    ],
  },
  {
    id: "openai",
    title: "Agent B credentials",
    subtitle: "Used by Fovea",
    icon: <OpenAIIcon />,
    testKey: "openai",
    fields: [
      { key: "OPENAI_API_KEY", label: "API key", placeholder: "sk-proj-…", hint: "Starts with sk-" },
    ],
    steps: [
      { label: "Go to platform.openai.com and sign in" },
      { label: "Open API Keys page", link: { text: "Open platform", url: "https://platform.openai.com/api-keys" } },
      { label: "Click Create new secret key, copy the value, paste it below" },
    ],
  },
  {
    id: "github",
    title: "GitHub",
    subtitle: "File context for suggestions + PR creation",
    icon: <GitHubIcon />,
    testKey: "github",
    fields: [
      { key: "GITHUB_TOKEN", label: "Personal Access Token", placeholder: "ghp_…", hint: "Needs repo scope" },
    ],
    steps: [
      { label: "Go to GitHub → Settings → Developer settings", link: { text: "Open settings", url: "https://github.com/settings/tokens/new" } },
      { label: "Select Classic token, tick the repo scope, set an expiry" },
      { label: "Generate token, copy it, paste it below" },
    ],
  },
  {
    id: "azurerepos",
    title: "Azure Repos",
    subtitle: "Azure Git repositories — file context + PR creation",
    icon: <AzureReposIcon />,
    testKey: "azurerepos",
    fields: [
      { key: "AZURE_REPOS_ORG", label: "Organisation", placeholder: "mycompany", hint: "The part after dev.azure.com/ in your browser URL" },
      { key: "AZURE_REPOS_TOKEN", label: "Personal Access Token", placeholder: "Paste your PAT here", hint: "Needs Code → Read & Write scope" },
    ],
    steps: [
      { label: "Open dev.azure.com and note your organisation name from the URL (dev.azure.com/{org})" },
      { label: "Click your avatar → Personal Access Tokens", link: { text: "Open ADO", url: "https://dev.azure.com" } },
      { label: "Click New Token — set scope to Code → Read & Write only (do NOT use Full access)" },
      { label: "Enter your organisation name above, paste the token, then click Test connection." },
    ],
  },
  {
    id: "jira",
    title: "JIRA",
    subtitle: "Sync tasks from your JIRA project board",
    icon: <JiraIcon />,
    testKey: "jira",
    fields: [
      { key: "JIRA_DOMAIN", label: "Domain", placeholder: "acme.atlassian.net", hint: "Just the domain, no https://" },
      { key: "JIRA_EMAIL", label: "Account email", placeholder: "you@company.com" },
      { key: "JIRA_API_TOKEN", label: "API Token", placeholder: "ATATT3xFfGF…", hint: "Created in Atlassian account settings" },
    ],
    steps: [
      { label: "Find your JIRA domain — it's the part before .atlassian.net in your browser URL" },
      { label: "Create an API token at id.atlassian.com", link: { text: "Create token", url: "https://id.atlassian.com/manage-profile/security/api-tokens" } },
      { label: "Click Create API token, give it a name, copy the value" },
      { label: "Fill in your domain, the email you log in with, and paste the token below" },
    ],
  },
  {
    id: "azuredevops",
    title: "Azure DevOps",
    subtitle: "Sync work items from your ADO project",
    icon: <AzureIcon />,
    testKey: "azuredevops",
    fields: [
      { key: "AZURE_DEVOPS_ORG", label: "Organisation", placeholder: "mycompany", hint: "The part after dev.azure.com/" },
      { key: "AZURE_DEVOPS_PROJECT", label: "Project (optional)", placeholder: "MyProject" },
      { key: "AZURE_DEVOPS_PAT", label: "Personal Access Token", placeholder: "Paste your PAT here", hint: "Needs Work Items read/write" },
    ],
    steps: [
      { label: "Open dev.azure.com, find your organisation name in the URL" },
      { label: "Go to User Settings → Personal Access Tokens", link: { text: "Open ADO", url: "https://dev.azure.com" } },
      { label: "Click New Token, set scope to Work Items → Read & Write, copy the token" },
      { label: "Fill in your organisation, project name (optional), and paste the token below" },
    ],
  },
  {
    id: "confluence",
    title: "Confluence",
    subtitle: "Publish Narratia runbooks to a Confluence space",
    icon: <ConfluenceIcon />,
    testKey: "confluence",
    fields: [
      { key: "CONFLUENCE_DOMAIN", label: "Domain", placeholder: "yoursite.atlassian.net", hint: "Just the domain, no https://" },
      { key: "CONFLUENCE_EMAIL", label: "Account email", placeholder: "you@company.com" },
      { key: "CONFLUENCE_API_TOKEN", label: "API Token", placeholder: "ATATT3xFfGF…" },
      { key: "CONFLUENCE_SPACE_KEY", label: "Space key", placeholder: "ENG", hint: "The space to publish to" },
    ],
    steps: [
      { label: "Create an API token at id.atlassian.com", link: { text: "Create token", url: "https://id.atlassian.com/manage-profile/security/api-tokens" } },
      { label: "Find your space key in the space settings (e.g. ENG)" },
      { label: "Fill in your domain, email, token, and space key below" },
    ],
  },
  {
    id: "notion",
    title: "Notion",
    subtitle: "Publish Narratia runbooks as Notion pages",
    icon: <NotionIcon />,
    testKey: "notion",
    fields: [
      { key: "NOTION_API_TOKEN", label: "Integration token", placeholder: "secret_…", hint: "From notion.so/my-integrations" },
      { key: "NOTION_PARENT_PAGE", label: "Parent page ID", placeholder: "32-char page ID", hint: "From the parent page URL" },
    ],
    steps: [
      { label: "Create an integration at notion.so/my-integrations", link: { text: "Open Notion", url: "https://www.notion.so/my-integrations" } },
      { label: "Share the parent page with your integration so it can post there" },
      { label: "Paste the integration token and the parent page ID (from the URL) below" },
    ],
  },
];

// ─── Icons ────────────────────────────────────────────────────────────────────

function AnthropicIcon() {
  return (<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="6" fill="#1a4fd6" /><text x="12" y="16" textAnchor="middle" fill="white" fontSize="11" fontWeight="700">A</text></svg>);
}
function OpenAIIcon() {
  return (<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="6" fill="#3a6cf0" /><text x="12" y="16" textAnchor="middle" fill="white" fontSize="11" fontWeight="700">B</text></svg>);
}
function GitHubIcon() {
  return (<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="6" fill="#24292E" /><path d="M12 3.5C7.3 3.5 3.5 7.3 3.5 12c0 3.75 2.44 6.94 5.82 8.07.43.08.59-.18.59-.41V18.3c-2.37.51-2.87-1.14-2.87-1.14-.39-1-.95-1.26-.95-1.26-.77-.53.06-.52.06-.52.85.06 1.3.88 1.3.88.76 1.3 1.99.92 2.47.7.08-.55.3-.92.54-1.13-1.89-.21-3.88-.95-3.88-4.21 0-.93.33-1.69.88-2.29-.09-.21-.38-1.08.08-2.25 0 0 .72-.23 2.35.88a8.2 8.2 0 0 1 2.15-.29c.73 0 1.46.1 2.15.29 1.63-1.11 2.35-.88 2.35-.88.46 1.17.17 2.04.08 2.25.55.6.87 1.36.87 2.29 0 3.27-1.99 3.99-3.89 4.2.31.27.58.8.58 1.61v2.38c0 .23.15.5.59.41A8.51 8.51 0 0 0 20.5 12C20.5 7.3 16.7 3.5 12 3.5Z" fill="white" /></svg>);
}
function JiraIcon() {
  return (<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="6" fill="#0052CC" /><text x="12" y="16" textAnchor="middle" fill="white" fontSize="10" fontWeight="700">J</text></svg>);
}
function AzureIcon() {
  return (<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="6" fill="#0078D4" /><text x="12" y="16" textAnchor="middle" fill="white" fontSize="9" fontWeight="700">ADO</text></svg>);
}
function AzureReposIcon() {
  return (<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="6" fill="#0078D4" /><path d="M17 7H13L7 12L13 17H17L11 12L17 7Z" fill="white" /><rect x="7" y="11" width="2" height="2" rx="1" fill="white" /></svg>);
}
function ConfluenceIcon() {
  return (<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="6" fill="#1868DB" /><text x="12" y="16" textAnchor="middle" fill="white" fontSize="10" fontWeight="700">C</text></svg>);
}
function NotionIcon() {
  return (<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="6" fill="#111" /><text x="12" y="16" textAnchor="middle" fill="white" fontSize="10" fontWeight="700">N</text></svg>);
}

// ─── Tone helpers (success/error using brand tokens) ────────────────────────────

const GREEN = "var(--accent-green)";
const RED = "var(--accent-red)";
function tone(color: string): React.CSSProperties {
  return {
    color,
    background: `color-mix(in srgb, ${color} 12%, transparent)`,
    borderColor: `color-mix(in srgb, ${color} 30%, transparent)`,
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusPill({ set }: { set: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={set ? tone(GREEN) : undefined}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: set ? GREEN : "var(--text-muted)" }} />
      <span className={set ? "" : "text-muted-foreground"}>{set ? "Configured" : "Not set"}</span>
    </span>
  );
}

function SecretInput({
  value, onChange, placeholder,
}: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="h-9 pr-9 font-mono text-sm"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        title={show ? "Hide" : "Show"}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function IntegrationCard({
  integration, configMap, onSaved,
}: { integration: Integration; configMap: ConfigMap; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const handleRemove = async (key: string) => {
    setRemoving(key);
    setRemoveError(null);
    try {
      const res = await fetch(`/api/config/${encodeURIComponent(key)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Remove failed");
      onSaved();
    } catch {
      setRemoveError("Failed to remove — please try again");
    } finally {
      setRemoving(null);
    }
  };

  const isConfigured = integration.fields.every((f) => configMap[f.key]?.set);

  const setField = (key: string, val: string) => {
    setValues((prev) => ({ ...prev, [key]: val }));
    setTestResult(null);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const payload: Record<string, string> = {};
      for (const f of integration.fields) {
        const v = values[f.key] ?? "";
        if (v) payload[f.key] = v;
      }
      const res = await fetch(`/api/config/test/${integration.testKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ok: boolean; message: string };
      setTestResult(data);
    } catch {
      setTestResult({ ok: false, message: "Network error — could not reach the server" });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const payload: Record<string, string> = {};
      for (const f of integration.fields) {
        const v = values[f.key] ?? "";
        if (v) payload[f.key] = v;
      }
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Save failed");
      setSaveMsg("Saved!");
      setValues({});
      onSaved();
      setTimeout(() => setSaveMsg(null), 3000);
    } catch {
      setSaveMsg("Failed to save — try again");
    } finally {
      setSaving(false);
    }
  };

  const hasNewValues = integration.fields.some((f) => (values[f.key] ?? "").trim().length > 0);

  return (
    <div className={`overflow-hidden rounded-md border bg-card transition-colors ${open ? "border-primary/60" : ""}`}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="shrink-0">{integration.icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground">{integration.title}</span>
          <span className="block truncate text-xs text-muted-foreground">{integration.subtitle}</span>
        </span>
        <StatusPill set={isConfigured} />
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t px-4 pb-4">
          {/* Steps */}
          <div className="my-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">How to obtain credentials</p>
            <ol className="flex list-none flex-col gap-2 p-0">
              {integration.steps.map((step, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border bg-muted text-[10px] font-bold text-muted-foreground">{i + 1}</span>
                  <span className="pt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                    {step.label}
                    {step.link && (
                      <>{" "}
                        <a href={step.link.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
                          {step.link.text} <ExternalLink className="h-3 w-3" />
                        </a>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          {/* Fields */}
          <div className="flex flex-col gap-3">
            {integration.fields.map((field) => (
              <div key={field.key}>
                <label className="mb-1.5 block text-xs font-medium text-foreground">
                  {field.label}
                  {field.hint && <span className="ml-1.5 font-normal text-muted-foreground">— {field.hint}</span>}
                </label>
                {configMap[field.key]?.set && !(field.key in values) ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 truncate rounded-md border bg-muted px-3 py-2 font-mono text-sm text-muted-foreground">
                      {configMap[field.key].masked}
                    </div>
                    <Button variant="outline" size="sm" className="h-9" onClick={() => setField(field.key, "")}>Replace</Button>
                    <Button
                      variant="outline" size="sm" className="h-9 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => handleRemove(field.key)} disabled={removing === field.key}
                    >
                      {removing === field.key ? "Removing…" : "Remove"}
                    </Button>
                  </div>
                ) : (
                  <SecretInput value={values[field.key] ?? ""} onChange={(v) => setField(field.key, v)} placeholder={field.placeholder} />
                )}
              </div>
            ))}
          </div>

          {removeError && (
            <div className="mt-3.5 flex items-center gap-2 rounded-md border px-3.5 py-2.5 text-[13px]" style={tone(RED)}>
              <X className="h-4 w-4" /> {removeError}
            </div>
          )}
          {testResult && (
            <div className="mt-3.5 flex items-center gap-2 rounded-md border px-3.5 py-2.5 text-[13px]" style={tone(testResult.ok ? GREEN : RED)}>
              {testResult.ok ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />} {testResult.message}
            </div>
          )}

          <div className="mt-4 flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-9" onClick={handleTest} disabled={testing}>
              {testing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {testing ? "Testing…" : "Test connection"}
            </Button>
            <Button size="sm" className="h-9" onClick={handleSave} disabled={saving || !hasNewValues}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {saving ? "Saving…" : saveMsg ?? "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProgressBar({ configured, total }: { configured: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((configured / total) * 100);
  const done = pct === 100;
  return (
    <div className="mb-6">
      <div className="mb-2 flex justify-between text-xs">
        <span className="text-muted-foreground">{configured} of {total} integrations configured</span>
        <span className="font-medium" style={{ color: done ? GREEN : "var(--text-muted)" }}>{pct}%</span>
      </div>
      <div className="h-1 overflow-hidden rounded bg-muted">
        <div className="h-full rounded transition-[width] duration-500" style={{ width: `${pct}%`, background: done ? GREEN : "var(--accent-blue)" }} />
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const GROUPS: { label: string; ids: string[] }[] = [
  { label: "Trackers", ids: ["jira", "azuredevops"] },
  { label: "Repositories", ids: ["github", "azurerepos"] },
  { label: "Agents", ids: ["anthropic", "openai"] },
  { label: "Documentation", ids: ["confluence", "notion"] },
];

export default function SettingsPage() {
  const { configMap, loading, error, refreshConfig } = useConfig();

  const configuredCount = INTEGRATIONS.filter((integ) => integ.fields.every((f) => configMap[f.key]?.set)).length;
  const byId = new Map(INTEGRATIONS.map((i) => [i.id, i]));

  return (
    <div className="mx-auto max-w-2xl px-6 py-6">
      <p className="mb-6 text-xs text-muted-foreground">
        Connect your tools. Credentials are stored securely in the database and loaded automatically on startup.
      </p>

      {loading ? (
        <div className="flex flex-col gap-2.5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 rounded-md border bg-card" style={{ animation: "dc-pulse 1.5s ease-in-out infinite" }} />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-md border px-4 py-3 text-[13px]" style={tone(RED)}>{error}</div>
      ) : (
        <>
          <ProgressBar configured={configuredCount} total={INTEGRATIONS.length} />
          {GROUPS.map((group) => (
            <div key={group.label} style={{ marginBottom: 24 }}>
              <div
                style={{
                  fontSize: "var(--fs-xs)",
                  color: "var(--c-ink-4)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  fontWeight: 600,
                  marginBottom: 10,
                }}
              >
                {group.label}
              </div>
              <div className="flex flex-col gap-2.5">
                {group.ids
                  .map((id) => byId.get(id))
                  .filter((i): i is Integration => Boolean(i))
                  .map((integ) => (
                    <IntegrationCard key={integ.id} integration={integ} configMap={configMap} onSaved={refreshConfig} />
                  ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
