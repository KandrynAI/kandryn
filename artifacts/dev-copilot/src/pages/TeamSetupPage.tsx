import { useState } from "react";
import { useLocation } from "wouter";
import { bootstrapTeam, createTeamInvite, ApiError, type TeamInfo } from "@/services/api";
import { useToast } from "@/hooks/use-toast";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

/** First-run workspace onboarding (rendered outside the AppShell). */
export default function TeamSetupPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [team, setTeam] = useState<TeamInfo | null>(null);

  // Step 2 (optional invite)
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [inviting, setInviting] = useState(false);

  const create = async () => {
    setCreating(true);
    try {
      const res = await bootstrapTeam(name.trim() || undefined);
      setTeam(res.team);
    } catch (err) {
      toast({
        title: "Could not create workspace",
        description: err instanceof ApiError ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const invite = async () => {
    if (!team || !email.trim()) return;
    setInviting(true);
    try {
      await createTeamInvite(team.id, email.trim(), role);
      toast({ title: "Invite sent", description: email.trim() });
      navigate("/dashboard");
    } catch (err) {
      toast({
        title: "Could not send invite",
        description: err instanceof ApiError ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setInviting(false);
    }
  };

  const inputStyle: React.CSSProperties = { width: "100%", padding: "10px 12px", fontSize: 14, border: "1px solid #d4dbe5", background: "#fff", color: "#161b24" };
  const primaryBtn: React.CSSProperties = { width: "100%", background: "#1a4fd6", color: "#fff", border: "none", padding: "12px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer" };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#eceff4", padding: 24, fontFamily: "'Archivo', system-ui, sans-serif" }}>
      <img src={`${basePath}/bluemantis-mark.png`} alt="Blue Mantis" style={{ height: 28, marginBottom: 20 }} />
      <div style={{ width: "100%", maxWidth: 440, background: "#fff", border: "2px solid color-mix(in srgb, #161b24 38%, transparent)", padding: 28 }}>
        {!team ? (
          <>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: "#161b24", margin: 0 }}>Create your workspace</h1>
            <p style={{ fontSize: 13, color: "#3c4553", lineHeight: 1.5, margin: "8px 0 18px" }}>Give your team a name. You can invite members next.</p>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#161b24", display: "block", marginBottom: 6 }}>Workspace name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Engineering" style={{ ...inputStyle, marginBottom: 16 }} />
            <button onClick={create} disabled={creating} style={{ ...primaryBtn, opacity: creating ? 0.7 : 1 }}>
              {creating ? "Creating…" : "Create workspace"}
            </button>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: "#161b24", margin: 0 }}>Invite your first teammate</h1>
            <p style={{ fontSize: 13, color: "#3c4553", lineHeight: 1.5, margin: "8px 0 18px" }}>
              <strong>{team.name}</strong> is ready. Invite someone now, or skip and do it later.
            </p>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#161b24", display: "block", marginBottom: 6 }}>Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" style={{ ...inputStyle, marginBottom: 12 }} />
            <label style={{ fontSize: 12, fontWeight: 600, color: "#161b24", display: "block", marginBottom: 6 }}>Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as "admin" | "member")} style={{ ...inputStyle, marginBottom: 16 }}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button onClick={invite} disabled={inviting || !email.trim()} style={{ ...primaryBtn, opacity: inviting || !email.trim() ? 0.7 : 1 }}>
              {inviting ? "Sending…" : "Send invite"}
            </button>
            <button onClick={() => navigate("/dashboard")} style={{ width: "100%", background: "transparent", color: "#1a4fd6", border: "none", padding: "12px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 8 }}>
              Skip for now
            </button>
          </>
        )}
      </div>
    </div>
  );
}
