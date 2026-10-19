# Sequence Guard — post-deploy verification

Everything below needs a live environment: Clerk, Supabase, a real tracker and
a real repository. None of it can be checked in the sandbox, which is why it is
a checklist rather than a test.

Run it on the **PnC demo** project.

## Before you start

- [ ] **`docs/db/0038_sequence_guard.sql` is applied in Supabase.** Confirm the
      trigger exists, not just the tables — `drizzle-kit push` creates the
      tables and **not** the trigger, and without it the decision rows are
      silently editable:
      ```sql
      SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'sequence_overrides'::regclass AND NOT tgisinternal;
      ```
      Expect one row: `sequence_overrides_immutable`.
- [ ] In Jira, create **A blocks B** as a real issue link, and a third item **C**
      with no links.
- [ ] Sync the board. Confirm the link arrived:
      ```sql
      SELECT from_item_id, to_item_id, source FROM work_item_links;
      ```

## The happy path

- [ ] **Run C** → starts immediately. No dialog, and no new rows in
      `sequence_checks` or `sequence_overrides`.
- [ ] **Run B** while A is open → the dialog opens with an `unmet_blocker`
      finding and "Do this first: A".
- [ ] **"Open A"** → audit log shows `sequence.heeded`.
- [ ] **Close the dialog** → audit log shows `sequence.canceled`.

## The override

- [ ] Step 2 shows an impact within 8 seconds, citing A by key.
- [ ] Confirm stays disabled until a category, a 15+ character reason and the
      checkbox are all done.
- [ ] After confirming: one run, one `sequence_overrides` row, audit shows
      `sequence.override_confirmed`. The row holds the impact text, the reason,
      the role, the IP and a `record_hash`.
- [ ] Commit that run → audit shows `sequence.override_outcome` with
      `committed`.

## The surfaces

- [ ] The board shows "Waits on A" on B only, not on A or C.
- [ ] **Run order** view shows A in wave 1 and B in wave 2.
- [ ] Settings → Team → Run order: switch to **admin override only**. A member
      sees no override button and the policy line instead; an admin still sees
      it.
- [ ] Switch to **off** → no checks, no dialogs, anywhere.
- [ ] Audit tab → **Decisions** lists the override; the detail drawer shows the
      frozen impact, and CSV export opens cleanly in a spreadsheet.

## The paths that are easy to get wrong

- [ ] **Scheduled hold.** Schedule B for tomorrow with an override, then add a
      new blocker D before it fires. At dispatch the run goes to `held`, an
      email arrives, and nothing is generated.
- [ ] **No model key.** Remove the Anthropic key (or break it). Step 2 shows
      "Standard assessment" and the override still completes. This is the one
      that matters most: the gate must not depend on a model being up.
- [ ] **Deleted run.** Delete an overridden run. The decision row survives with
      `run_id` null and its hash unchanged.
- [ ] **Direct tamper.** `UPDATE sequence_overrides SET reason_text = 'x';`
      fails with `sequence_overrides rows are immutable`.
- [ ] **Azure DevOps.** Relations need their own API call there; confirm a
      `Predecessor`/`Successor` link syncs into `work_item_links`. If ADO
      returns nothing, the sync must still succeed — losing the order check is
      acceptable, losing the board is not.

## Security

- [ ] `POST /api/work-items/:id/runs` for a warning item with no sequence block
      → 409, and no run row created.
- [ ] A `checkId` belonging to another team → 404.
- [ ] A member calling `GET /api/sequence-overrides` → 403.
- [ ] No file contents and no credential values appear in `sequence_checks.facts`,
      `sequence_overrides.impact_shown`, or any audit row. File **paths** are
      expected and fine.

## Known limits, by design

- **"Done" comes from the tracker, not the pull request.** Kandryn never learns
  that a PR merged. An item whose PR has landed but whose ticket is still open
  reports as `blocker_pr_unmerged` — a caution, not a warning. The impact step
  does a live PR lookup and will say it actually merged. The error is in the
  safe direction.
- **Jira has no backlog rank.** Its rank is a LexoRank string on a per-site
  custom field the sync does not request, so `out_of_rank` never fires on Jira.
  Azure DevOps has it via `StackRank`.
- **Parent edges are not stored.** `tasks.parent_id` is the source of truth;
  `work_item_links` carries `blocks` edges only.
- **Inferred prerequisites are not built** (spec step 9, skipped deliberately).
  Every edge in the graph came from a tracker or a human.
