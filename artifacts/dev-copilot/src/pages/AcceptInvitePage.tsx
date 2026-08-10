import { useState } from "react";
import { useLocation } from "wouter";
import { useClerk } from "@clerk/react";
import { acceptTeamInvite, ApiError } from "@/services/api";
import { useToast } from "@/hooks/use-toast";
import { Logo } from "@/components/Logo";

/** Standalone invite-accept screen (rendered outside the AppShell). */
export default function AcceptInvitePage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { signOut } = useClerk();
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    if (!token) {
      setError("This invite link is missing its token.");
      return;
    }
    setAccepting(true);
    setError(null);
    try {
      await acceptTeamInvite(token);
      toast({ title: "Welcome to the team!" });
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not accept this invite.");
    } finally {
      setAccepting(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#eceff4", padding: 24, fontFamily: "'Archivo', system-ui, sans-serif" }}>
      <Logo context="signin" height={28} style={{ marginBottom: 20 }} />
      <div style={{ width: "100%", maxWidth: 420, background: "#fff", border: "2px solid color-mix(in srgb, #161b24 38%, transparent)", padding: 28 }}>
        <div style={{ fontSize: 13, color: "#3c4553" }}>You've been invited to join</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#161b24", margin: "4px 0 6px", letterSpacing: "-0.01em" }}>a Blue Mantis team</div>
        <p style={{ fontSize: 13, color: "#3c4553", lineHeight: 1.5, marginBottom: 20 }}>
          Accepting adds this workspace to your account. You can switch between your own work and the team's.
        </p>
        {error && (
          <div style={{ fontSize: 13, color: "#c0392b", background: "#fdecea", border: "1px solid #f5c6cb", padding: "8px 12px", marginBottom: 16 }}>{error}</div>
        )}
        <button
          onClick={accept}
          disabled={accepting}
          style={{ width: "100%", background: "#1a4fd6", color: "#fff", border: "none", padding: "12px 16px", fontSize: 14, fontWeight: 700, cursor: accepting ? "default" : "pointer", opacity: accepting ? 0.7 : 1 }}
        >
          {accepting ? "Accepting…" : "Accept invite"}
        </button>
        <button
          onClick={() => signOut(() => navigate("/sign-in"))}
          style={{ width: "100%", background: "transparent", color: "#1a4fd6", border: "none", padding: "12px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 8 }}
        >
          Sign in with a different account
        </button>
      </div>
    </div>
  );
}
