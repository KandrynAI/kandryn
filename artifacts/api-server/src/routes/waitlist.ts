import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { db, waitlistTable } from "@workspace/db";
import { sendWaitlistNotification, sendWaitlistConfirmation } from "../services/emailService.js";

const router: IRouter = Router();

const WaitlistBody = z.object({
  email: z.string().email("A valid email is required"),
  name: z.string().max(160).optional(),
  company: z.string().max(200).optional(),
  role: z.string().max(160).optional(),
});

/**
 * POST /api/waitlist — public (no auth). Stores a prospect on the launch
 * waitlist and fires a best-effort notification email to the team.
 */
router.post("/waitlist", async (req, res) => {
  const parsed = WaitlistBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid submission" });
  }

  const { email, name, company, role } = parsed.data;
  const clean = (v?: string) => {
    const t = v?.trim();
    return t && t.length > 0 ? t : null;
  };
  const normalizedEmail = email.toLowerCase().trim();

  // Duplicate check — if this email is already on the waitlist, tell the client
  // (don't insert again or re-send the emails).
  const existing = await db
    .select({ id: waitlistTable.id })
    .from(waitlistTable)
    .where(eq(waitlistTable.email, normalizedEmail))
    .limit(1);
  if (existing.length > 0) {
    return res.status(200).json({ ok: true, alreadyJoined: true });
  }

  const [row] = await db
    .insert(waitlistTable)
    .values({
      email: normalizedEmail,
      name: clean(name),
      company: clean(company),
      role: clean(role),
      source: "kandryn.com",
    })
    .onConflictDoNothing({ target: waitlistTable.email })
    .returning();

  // Lost a race to a concurrent insert (unique index on email) → already joined.
  if (!row) {
    return res.status(200).json({ ok: true, alreadyJoined: true });
  }

  // Await the emails so they finish before the serverless function freezes once
  // the response is sent (fire-and-forget gets killed mid-connection on Vercel).
  // Failures are logged but never fail the signup itself.
  const entry = { email, name: clean(name), company: clean(company), role: clean(role) };
  const [notify, confirm] = await Promise.allSettled([
    sendWaitlistNotification(entry),
    sendWaitlistConfirmation(entry),
  ]);
  if (notify.status === "rejected") req.log.warn({ err: notify.reason }, "Waitlist notification email failed");
  if (confirm.status === "rejected") req.log.warn({ err: confirm.reason }, "Waitlist confirmation email failed");

  return res.status(201).json({ ok: true, alreadyJoined: false, id: row?.id });
});

export default router;
