import { logger } from "../lib/logger.js";

/** Where new waitlist signups are emailed (internal team notification). */
const NOTIFY_TO = "arvind.kandula@venakaninfo.com";
/** Where website contact / walkthrough submissions are emailed. */
const CONTACT_TO = ["arvind.kandula@venakaninfo.com", "accounts@venakaninfo.com"];
const LINKEDIN_URL = "https://www.linkedin.com/company/venakan/";
const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface WaitlistEntry {
  email: string;
  name?: string | null;
  company?: string | null;
  role?: string | null;
}

interface ResendPayload {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  reply_to?: string;
}

/**
 * Low-level send via the Resend HTTP API. Throws on a non-OK response so the
 * caller can log it. Returns `false` (no-op) when RESEND_API_KEY isn't set.
 *
 * Env:
 *   RESEND_API_KEY      — Resend API key
 *   WAITLIST_FROM_EMAIL — verified from address, e.g. "Blue Mantis <hello@venakaninfo.com>"
 */
async function sendViaResend(payload: ResendPayload): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn("RESEND_API_KEY not set — email skipped");
    return false;
  }
  const from = process.env.WAITLIST_FROM_EMAIL || "Blue Mantis <onboarding@resend.dev>";

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, ...payload }),
    // Bound the call so a slow/unreachable Resend can't hold the request open.
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend responded ${res.status}: ${body}`);
  }
  return true;
}

/** Send a team invite email with the accept link (0017 multi-tenancy). */
export async function sendTeamInvite(to: string, teamName: string, inviteUrl: string): Promise<void> {
  const text = [
    `You've been invited to join ${teamName} on Blue Mantis.`,
    "",
    `Accept the invite: ${inviteUrl}`,
    "",
    "This link expires in 7 days.",
  ].join("\n");
  await sendViaResend({
    to: [to],
    subject: `You've been invited to join ${teamName} on Blue Mantis`,
    text,
  });
}

/** Internal notification to the team about a new signup. */
export async function sendWaitlistNotification(entry: WaitlistEntry): Promise<void> {
  const text = [
    "New Blue Mantis waitlist signup",
    "",
    `Email:   ${entry.email}`,
    entry.name ? `Name:    ${entry.name}` : null,
    entry.company ? `Company: ${entry.company}` : null,
    entry.role ? `Role:    ${entry.role}` : null,
    "",
    "— getbluemantis.com",
  ]
    .filter((l) => l !== null)
    .join("\n");

  await sendViaResend({
    to: [NOTIFY_TO],
    reply_to: entry.email,
    subject: `New waitlist signup: ${entry.email}`,
    text,
  });
}

/** Friendly, branded confirmation to the prospect who just joined. */
export async function sendWaitlistConfirmation(entry: WaitlistEntry): Promise<void> {
  const firstName = (entry.name ?? "").trim().split(/\s+/)[0] || "there";
  const text = [
    `Hi ${firstName},`,
    "",
    "Thanks for joining the Blue Mantis waitlist — you're on the list! 🎉",
    "",
    "Blue Mantis is the AI dev team that ships your backlog: it connects to your PLMs and",
    "code repositories, picks up open work autonomously, and hands you the authority to",
    "review and deploy — cutting delivery time on routine work from days to minutes.",
    "",
    "We're launching on 2 July 2026 and will email you the moment early access opens.",
    "",
    `Follow our journey on LinkedIn: ${LINKEDIN_URL}`,
    "",
    "Powered by Venakan Info Solutions",
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0C1E2E;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0C1E2E;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0E2841;border:1px solid #1A3D58;border-radius:16px;overflow:hidden;">
          <tr><td style="padding:28px 32px 8px;">
            <div style="font-size:18px;font-weight:700;color:#F2F2F2;letter-spacing:-0.01em;">Blue&nbsp;Mantis</div>
          </td></tr>
          <tr><td style="padding:8px 32px 0;">
            <h1 style="margin:0;color:#F2F2F2;font-size:24px;line-height:1.25;">You're on the waitlist 🎉</h1>
            <p style="margin:14px 0 0;color:#B0C4D8;font-size:15px;line-height:1.6;">
              Hi ${escapeHtml(firstName)}, thanks for joining! Blue&nbsp;Mantis is the AI dev team that ships your backlog —
              it connects to your <strong style="color:#F2F2F2;">PLMs and code repositories</strong>, picks up open work
              <strong style="color:#F2F2F2;">autonomously</strong>, and hands you the authority to
              <strong style="color:#F2F2F2;">review&nbsp;&amp;&nbsp;deploy</strong> — turning days of routine work into minutes.
            </p>
          </td></tr>
          <tr><td style="padding:20px 32px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" style="background:#143552;border-radius:10px;width:100%;">
              <tr><td style="padding:14px 18px;color:#B0C4D8;font-size:14px;">
                🚀 Launching <strong style="color:#02B8A0;">2&nbsp;July&nbsp;2026</strong>. We'll email you the moment early access opens.
              </td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:22px 32px 4px;" align="center">
            <a href="${LINKEDIN_URL}" style="display:inline-block;background:#0A66C2;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 20px;border-radius:10px;">Follow us on LinkedIn</a>
          </td></tr>
          <tr><td style="padding:24px 32px 28px;border-top:1px solid #1A3D58;margin-top:16px;">
            <p style="margin:16px 0 0;color:#607D93;font-size:12px;line-height:1.5;text-align:center;">
              Powered by <strong style="color:#02B8A0;">Venakan Info Solutions</strong><br/>
              You're receiving this because you joined the waitlist at getbluemantis.com
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  await sendViaResend({
    to: [entry.email],
    subject: "You're on the Blue Mantis waitlist 🎉",
    text,
    html,
  });
}

export interface ContactSubmission {
  type: "request-access" | "walkthrough";
  name: string;
  email: string;
  company: string;
  teamSize?: string | null;
  preferredTime?: string | null;
  message?: string | null;
}

/**
 * Notify the team about a website "Request access" or "Book a walkthrough"
 * submission. Sends to both internal recipients; reply-to is the prospect.
 */
export async function sendContactEmail(sub: ContactSubmission): Promise<void> {
  const label = sub.type === "walkthrough" ? "Book a walkthrough" : "Request access";
  const text = [
    `New Blue Mantis ${label} submission`,
    "",
    `Name:    ${sub.name}`,
    `Email:   ${sub.email}`,
    `Company: ${sub.company}`,
    sub.teamSize ? `Team size:      ${sub.teamSize}` : null,
    sub.preferredTime ? `Preferred time: ${sub.preferredTime}` : null,
    sub.message ? `\nMessage:\n${sub.message}` : null,
    "",
    "— getbluemantis.com",
  ]
    .filter((l) => l !== null)
    .join("\n");

  await sendViaResend({
    to: CONTACT_TO,
    reply_to: sub.email,
    subject: `${label}: ${sub.company} (${sub.email})`,
    text,
  });
}

const APP_BASE = process.env.APP_BASE_URL || "https://getbluemantis.com";

/** Notify the run owner that a scheduled run finished (§5.5). */
export async function sendRunCompleted(
  to: string,
  d: { itemTitle: string; itemKey?: string | null; runId: number; agentCount: number; topScore?: number | null; prUrl?: string | null },
): Promise<void> {
  const text = [
    "Your scheduled Blue Mantis run finished.",
    "",
    `Work item: ${d.itemKey ? `${d.itemKey} — ` : ""}${d.itemTitle}`,
    `Agents: ${d.agentCount}${d.topScore != null ? `, top score ${d.topScore}/10` : ""}`,
    d.prUrl ? `Pull request: ${d.prUrl}` : "Suggestions are ready for your review.",
    "",
    `Review the run: ${APP_BASE}/app/runs/${d.runId}`,
    "",
    "— getbluemantis.com",
  ].join("\n");
  await sendViaResend({ to: [to], subject: `Run finished: ${d.itemTitle}`, text });
}

/** Notify the run owner that a scheduled run failed (§5.5). */
export async function sendRunFailed(
  to: string,
  d: { itemTitle: string; runId: number; error: string },
): Promise<void> {
  const text = [
    "Your scheduled Blue Mantis run did not complete.",
    "",
    `Work item: ${d.itemTitle}`,
    `Reason: ${d.error}`,
    "",
    `Details: ${APP_BASE}/app/runs/${d.runId}`,
    "",
    "— getbluemantis.com",
  ].join("\n");
  await sendViaResend({ to: [to], subject: `Run failed: ${d.itemTitle}`, text });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
