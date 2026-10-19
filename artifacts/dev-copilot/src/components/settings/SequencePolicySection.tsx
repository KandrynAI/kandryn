import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { fetchSequencePolicy, updateSequencePolicy, type SequencePolicy } from "@/services/api";
import { useToast } from "@/hooks/use-toast";

const OPTIONS: Array<{ value: SequencePolicy; label: string; help: string }> = [
  { value: "off", label: "Off", help: "Do not check run order." },
  { value: "warn", label: "Warn", help: "Warn and let any member override with a reason." },
  {
    value: "admin_override_only",
    label: "Admin override only",
    help: "Warn. Only admins can override.",
  },
];

/**
 * Run-order policy, for team admins.
 *
 * Deliberately not disabled while saving: the radio reflects what the user
 * just chose and reverts if the save fails, which reads better than a frozen
 * control.
 */
export default function SequencePolicySection() {
  const { toast } = useToast();
  const [policy, setPolicy] = useState<SequencePolicy | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSequencePolicy()
      .then((r) => setPolicy(r.policy))
      .catch(() => setPolicy(null));
  }, []);

  const choose = async (next: SequencePolicy) => {
    const previous = policy;
    setPolicy(next);
    setSaving(true);
    try {
      await updateSequencePolicy(next);
      toast({ title: "Run order policy saved" });
    } catch (err) {
      setPolicy(previous);
      toast({
        title: "Could not save the policy",
        description: err instanceof Error ? err.message : "Something went wrong.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (policy === null) return null;

  return (
    <section style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: "var(--fs-sm)", fontWeight: 600, marginBottom: 2 }}>
        Run order
        {saving ? <Loader2 size={12} className="animate-spin" style={{ marginLeft: 6, verticalAlign: "-1px" }} /> : null}
      </h3>
      <p style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-3)", marginBottom: 8 }}>
        Kandryn generates from the default branch, so an unfinished prerequisite is invisible to a run.
      </p>
      <div style={{ display: "grid", gap: 6 }}>
        {OPTIONS.map((o) => (
          <label key={o.value} style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
            <input
              type="radio"
              name="sequence-policy"
              checked={policy === o.value}
              onChange={() => void choose(o.value)}
              style={{ marginTop: 3 }}
            />
            <span>
              <span style={{ fontSize: "var(--fs-sm)" }}>{o.label}</span>
              <span style={{ display: "block", fontSize: "var(--fs-xs)", color: "var(--c-ink-4)" }}>{o.help}</span>
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}
