-- Kandryn — the Jira app (Forge), phase 1  (migration 0043)
--
-- Kandryn appears inside Jira Cloud as a read-only issue panel. These four
-- tables are everything the extension needs: which Jira sites have the app
-- installed, which Jira user is which Kandryn user, the short-lived codes that
-- bind the two, and a cache of cloud id -> site host.
--
-- IDENTITY IS THE WHOLE POINT. A Jira user is nobody until they link once, by
-- TYPING a code they generated in their own Jira panel. The code is never
-- carried in a URL: a link would let an attacker start a link from their own
-- Jira account, send the URL to a Kandryn user, and have the victim attach the
-- attacker's Jira account to the victim's Kandryn data. Typing a code the
-- person reads in their own panel closes that.
--
-- Phase 1 is read-only. Nothing is written to Jira and nothing can be started
-- from Jira. The extension never touches integration_configs: it does not use
-- the existing PLM credentials, and it reads the Jira site from the signed
-- Forge invocation token, never from a value the panel sends.
--
-- No trigger is installed here, so the "drizzle-kit push does not create
-- triggers" trap (0033, 0038) does not apply to this migration. The three
-- indexes DO matter: push drops any index it cannot see in the Drizzle schema
-- (the 0041 pitfall), so each one is declared there as well.
--
-- Additive + idempotent. Safe to re-run.

-- Where the app is installed. One row per Forge installation id.
CREATE TABLE IF NOT EXISTS jira_installations (
  id               serial       PRIMARY KEY,
  installation_id  text         NOT NULL,
  cloud_id         text         NOT NULL,
  -- From the token's signed context.siteUrl claim, normalized. Nullable
  -- because a token may arrive before the claim is seen.
  site_url         text,
  environment      text         NOT NULL DEFAULT 'production',
  status           text         NOT NULL DEFAULT 'active',   -- active | disabled
  installed_at     timestamptz  NOT NULL DEFAULT now(),
  last_seen_at     timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS jira_installations_installation_uq
  ON jira_installations (installation_id);

-- Which Jira user is which Kandryn user. `atlassian_account_id` holds the
-- token's `principal` claim: the Atlassian docs call it the invoking user's
-- identifier and do not state that it equals the account id, so the column is
-- named for its purpose and treated as an opaque bounded string.
CREATE TABLE IF NOT EXISTS jira_account_links (
  id                    serial       PRIMARY KEY,
  installation_id       integer      NOT NULL REFERENCES jira_installations(id) ON DELETE CASCADE,
  atlassian_account_id  text         NOT NULL,
  user_id               text         NOT NULL,   -- Clerk user id
  created_at            timestamptz  NOT NULL DEFAULT now(),
  revoked_at            timestamptz
);

-- One ACTIVE link per (installation, Atlassian user). Revoked rows stay for
-- audit, so the uniqueness is partial. A second active link raises 23505,
-- which the route turns into a 409 rather than overwriting a link.
CREATE UNIQUE INDEX IF NOT EXISTS jira_account_links_active_uq
  ON jira_account_links (installation_id, atlassian_account_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS jira_account_links_user_idx
  ON jira_account_links (user_id);

-- The typed linking codes. Only the sha256 is stored, never the code, so a
-- database reader cannot complete somebody's link.
CREATE TABLE IF NOT EXISTS jira_link_codes (
  id                    serial       PRIMARY KEY,
  code_hash             text         NOT NULL UNIQUE,
  installation_id       integer      NOT NULL REFERENCES jira_installations(id) ON DELETE CASCADE,
  atlassian_account_id  text         NOT NULL,
  expires_at            timestamptz  NOT NULL,
  used_at               timestamptz,
  failed_attempts       integer      NOT NULL DEFAULT 0,
  created_at            timestamptz  NOT NULL DEFAULT now()
);

-- cloud id -> site host, fed from the signed token claim. A cache for
-- normalization and for showing a site name on the link page; never a
-- substitute for the token.
CREATE TABLE IF NOT EXISTS jira_site_map (
  id           serial       PRIMARY KEY,
  cloud_id     text         NOT NULL UNIQUE,
  -- Normalized: https scheme, lowercase host, no trailing slash.
  site_url     text         NOT NULL,
  resolved_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jira_site_map_site_url_idx
  ON jira_site_map (site_url);
