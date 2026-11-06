# Kandryn's Jira Cloud app (Forge) — phase 1

A read-only Kandryn panel on a Jira issue: whether the issue is in Kandryn, its
confidence score, any run-order warnings, and the latest run with its pull
request. **Nothing is written to Jira and nothing can be started from here.**
A Run button, a board view and Azure DevOps are later phases.

This folder is **outside the pnpm workspace** on purpose — the workspace globs
are `artifacts/*`, `lib/*`, `lib/integrations/*` and `scripts`, so a root-level
`integrations/` is not picked up. Use **npm** in here, like `website/`.

> Careful: `lib/integrations/*` **is** a workspace glob. This folder must stay
> at the repository root. Moving it under `lib/` would pull it into the pnpm
> workspace and break both installs.

## What it needs from Kandryn

| | |
|---|---|
| `FORGE_APP_ID` | the app id `forge register` prints, e.g. `ari:cloud:ecosystem::app/1234…`. **Set this in Vercel.** Until it is set, every `/api/ext/jira` route answers 503 |
| `APP_BASE_URL` | `https://app.kandryn.com` — the origin in the link page URL the panel shows |
| `JIRA_EXT_ENABLED` | optional kill switch; `false` turns the feature off without a deploy |
| `ALLOW_FORGE_DEV_ENV` | set `true` **only** if you want a `forge deploy -e development` install to read production data |

Migration `docs/db/0043_jira_forge.sql` must already be applied.

## Runbook

Everything below runs on your machine, not in CI. None of it was run for you:
the Forge CLI needs your Atlassian login.

### 1. Once, to set up

The CLI pins a Node **patch** floor — currently `^22.23.4 || ^24.22.1 ||
>=26.12.1`. Node 24.16 is in the right major and still refused, so check
`node -v` before blaming anything else. Under nvm, global npm packages are
per-version, so switching Node means reinstalling `@forge/cli`.

```sh
# An Atlassian account and a free Jira Cloud developer site:
#   https://go.atlassian.com/cloud-dev
# An API token for the CLI:
#   https://id.atlassian.com/manage-profile/security/api-tokens

npm install -g @forge/cli
forge login          # email + the API token above
```

### 2. Register the app

```sh
cd integrations/jira-forge
npm install
forge register kandryn
```

`forge register` **writes `app.id` into `manifest.yml`**. Commit the change it
makes.

**`app.runtime` is required too**, even though this app declares no Forge
functions at all — it is Custom UI plus a remote. The docs mark `runtime` as
required with no exception for that case, and `forge lint` rejects the manifest
without it (`app must have required property 'runtime'`). `nodejs24.x` is the
recommended value and matches the Node 24 the rest of Kandryn runs on. Neither
requirement surfaces until lint refuses you, which is why both are written down
here.

Copy the app id it prints into Vercel as `FORGE_APP_ID`, on every environment
the Kandryn API serves. Redeploy Kandryn so the API picks it up.

> Do not run `forge register` twice. The docs are explicit that re-registering
> disconnects the app from its environments, stored variables and storage.

`.forge/` is gitignored, per Atlassian's own guidance.

### 3. Build and deploy

```sh
npm run build                   # writes static/panel/{index.html,index.js,icon.svg}
forge lint
forge deploy -e development
```

The build is **not** optional and **not** committed: `static/` is gitignored,
and `forge deploy` uploads whatever is on disk. A deploy without a build ships
an empty resource directory and the panel renders blank.

### 4. Install on a site

```sh
forge install -e development -p jira -s your-site.atlassian.net
```

You must be an **admin** of that site. The scope screen will show **no Jira
scopes** — `permissions.scopes` is empty, which is correct and the shortest
path through Atlassian's review.

Open any issue, then the Kandryn panel from the issue's app list.

### 5. Local development

```sh
forge tunnel
```

The tunnel serves the panel from your machine against the installed app. It
does **not** tunnel the Kandryn API: the remote's `baseUrl` in the manifest is
still `https://app.kandryn.com`.

**For a development environment pointing at a non-production Kandryn**, change
`remotes[0].baseUrl` and deploy to that environment. Vercel preview URLs change
on every deploy, so point it at a **stable Vercel alias**, not a preview URL.
Changing `baseUrl` forces a major version upgrade that a site admin must
re-approve.

### 6. Production

```sh
npm run build
forge deploy -e production
```

Then share it privately — no Marketplace listing is needed:

1. developer console → your app → **Distribution** → **Edit**
2. **Sharing** (or **Sharing within organization** only if every installing
   admin is in your own Atlassian organization)
3. choose **Jira** as the Atlassian app
4. copy the installation link and send it to the customer's **site admin**

A new link disables the old one, irreversibly. An app with a `license` in its
manifest, or one submitted for listing, cannot be shared by link at all.

## Design notes worth knowing before you change anything

**The panel cannot assert its own identity.** The installation, the Jira user
and the Jira site all come out of the signed Forge invocation token on the
server. `view.getContext()` gives the issue key, and Atlassian is explicit that
context values are *not* valid for authorization — which is fine here, because
the key travels to Kandryn as a **lookup term only** and the server searches
only the projects the linked Kandryn user may already see. A panel that lied
about the key could ask about nothing but its own data. **Do not** start sending
the site, the account or the installation from the panel.

**The linking code is typed, never clicked.** `/link/start` returns a `pageUrl`
with no code in it. A clickable code would let someone mint one against their
own Jira account, send the link to a Kandryn user, and have that user's click
bind the attacker's Jira account to the victim's data.

**No red, ever.** Amber is the strongest tone. An unimported issue or an
ordering caution is not a failure, and red inside a customer's Jira reads as
"Kandryn is broken".

**The panel stores nothing** — no localStorage, no sessionStorage, no cookies.
Every render is a fresh call.

**Raw errors never reach the screen.** Whatever comes back — a 403 for a
disabled installation, a 503 for the kill switch, a network failure — the panel
says one sentence of its own.

## Known limits in this phase

- **Matching is by Jira key.** Kandryn stores the issue key, not the numeric id,
  so moving an issue between Jira projects shows "not imported" until the next
  sync. The panel already sends `issueId` so the server contract need not change
  when that is fixed.
- **One hardcoded URL.** `kandrynBase()` in `src/panel.ts` is
  `https://app.kandryn.com`, used only for "Open Kandryn" on the not-imported
  state. A development install's link therefore points at production. The fix,
  when it matters, is to echo `APP_BASE_URL` in the issue response rather than
  to hardcode a second value here.
- **Declaring a remote forfeits the "Runs on Atlassian" badge**, since a remote
  is data egress. Accepted deliberately.
