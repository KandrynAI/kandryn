import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff } from "lucide-react";

/**
 * Credential keys that hold a secret (API key / token / PAT) — these get a
 * masked input with a show/hide eye toggle. Everything else (domain, email,
 * organisation, project, space key, page id) is plain text with no toggle.
 */
export const SECRET_KEYS = new Set<string>([
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_GEMINI_API_KEY",
  "GITHUB_COPILOT_TOKEN",
  "GITHUB_TOKEN",
  "AZURE_REPOS_TOKEN",
  "AZURE_DEVOPS_PAT",
  "JIRA_API_TOKEN",
  "CONFLUENCE_API_TOKEN",
  "NOTION_API_TOKEN",
]);

export function isSecret(key: string): boolean {
  return SECRET_KEYS.has(key);
}

// Success/error tones using brand tokens.
export const GREEN = "var(--accent-green)";
export const RED = "var(--accent-red)";
export function tone(color: string): React.CSSProperties {
  return {
    color,
    background: `color-mix(in srgb, ${color} 12%, transparent)`,
    borderColor: `color-mix(in srgb, ${color} 30%, transparent)`,
  };
}

/** Small inline green/grey "Configured" / "Not set" badge for a field or card. */
export function StatusPill({ set }: { set: boolean }) {
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

/** Masked credential input with a show/hide eye toggle. */
export function SecretInput({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        className="h-9 pr-9 font-mono text-sm"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        aria-label={show ? "Hide value" : "Show value"}
        title={show ? "Hide" : "Show"}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
