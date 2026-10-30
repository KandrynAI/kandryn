import { invokeRemote, router, view } from "@forge/bridge";

/**
 * The Kandryn panel on a Jira issue — phase 1, read-only.
 *
 * What it shows: whether this issue is in Kandryn, its confidence score, any
 * run-order warnings, and the latest run with its pull request. Nothing can be
 * started from here and nothing is written to Jira.
 *
 * Three rules this file keeps.
 *
 *  - **It stores nothing.** No localStorage, no sessionStorage, no cookies.
 *    Every render comes from a fresh call, so there is nothing stale to
 *    invalidate and nothing of a previous user's left in a shared browser.
 *
 *  - **It never shows a raw error.** Whatever comes back, the panel says one
 *    sentence of its own. A backend message, a status code or a stack trace in
 *    somebody else's issue view is noise at best and a leak at worst.
 *
 *  - **No red.** Amber is the strongest tone here. An unimported issue or an
 *    ordering caution is not a failure, and red inside a customer's Jira reads
 *    as "Kandryn is broken".
 *
 * On trust: `view.getContext()` gives the issue key, and Atlassian is explicit
 * that context values are NOT safe for authorization. That is fine here, and
 * by design: the key travels to Kandryn as a lookup term only. The Jira site
 * and the calling user come from the signed invocation token, and the server
 * searches only the projects the linked Kandryn user may already see. A panel
 * that lied about the key could therefore only ask about its own data.
 */

const API = "/api/ext/jira/v1";

// ---------------------------------------------------------------------------
// The server's contract. Only these fields exist; anything else is ignored.
// ---------------------------------------------------------------------------

interface Blocker {
  key: string;
  title: string;
  state: string;
}

interface ReadyView {
  state: "ready";
  workItem: { id: number; title: string; status: string };
  confidence: { score: number; label: string } | null;
  order: { status: "ok" | "warning" | "unknown"; blockers: Blocker[]; moreCount: number };
  latestRun: { id: number; status: string; startedAt: string | null; prUrl: string | null } | null;
  links: { openInKandryn: string };
  degraded?: string[];
}

type IssueView = { state: "not_linked" } | { state: "not_in_kandryn" } | ReadyView;

// ---------------------------------------------------------------------------
// Rendering helpers. Plain DOM: the panel is a dozen rows, and a framework
// would be more bundle than content.
// ---------------------------------------------------------------------------

const root = (): HTMLElement => {
  const el = document.getElementById("root");
  if (!el) throw new Error("panel root missing");
  return el;
};

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A label/value row. `value` may be a string or a built node. */
function row(label: string, value: string | Node): HTMLElement {
  const r = el("div", "row");
  r.append(el("div", "label", label));
  const v = el("div", "value");
  if (typeof value === "string") v.textContent = value;
  else v.append(value);
  r.append(v);
  return r;
}

type Tone = "neutral" | "blue" | "green" | "amber";

function lozenge(text: string, tone: Tone): HTMLElement {
  return el("span", `lozenge lz-${tone}`, text);
}

function button(text: string, onClick: () => void): HTMLElement {
  const b = el("button", undefined, text);
  b.addEventListener("click", onClick);
  return b;
}

/** A link out to Kandryn. `router.open` is what keeps it a real new tab. */
function externalLink(text: string, url: string): HTMLElement {
  const a = el("button", "linkish", text);
  a.addEventListener("click", () => {
    void router.open(url);
  });
  return a;
}

function render(...nodes: Node[]): void {
  const r = root();
  r.replaceChildren(...nodes);
}

/** A run status, toned without ever reaching for red. */
function runTone(status: string): Tone {
  if (status === "succeeded") return "green";
  if (status === "running" || status === "queued" || status === "scheduled") return "blue";
  // `failed`, `canceled`, `held`, `awaiting_review` — all amber. A failed run
  // is information, not an alarm in someone else's issue view.
  return "amber";
}

function shortTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function showLoading(): void {
  render(el("p", "msg", "Loading…"));
}

function showError(): void {
  // One sentence, always. Never the status, never the body.
  render(
    el("p", "msg", "Kandryn could not be reached."),
    (() => {
      const actions = el("div", "actions");
      actions.append(button("Retry", () => void load()));
      return actions;
    })(),
  );
}

function showNotLinked(): void {
  const actions = el("div", "actions");
  actions.append(button("Get a code", () => void getCode()));
  actions.append(button("Check again", () => void load()));
  render(el("p", "msg", "Connect your Kandryn account to see this issue."), actions);
}

/**
 * The code, shown large enough to read off the screen and type elsewhere.
 *
 * The link opens the Kandryn page WITHOUT the code — the person types it. A
 * clickable code is the attack the whole linking design exists to prevent, so
 * the code never leaves this panel except through someone's keyboard.
 */
function showCode(code: string, expiresInSeconds: number, pageUrl: string): void {
  const minutes = Math.max(1, Math.round(expiresInSeconds / 60));
  const actions = el("div", "actions");
  actions.append(externalLink("Open Kandryn to enter the code", pageUrl));
  actions.append(button("Check again", () => void load()));
  render(
    el("p", "msg", "Type this code into Kandryn to connect your account."),
    el("div", "code", code),
    el("div", "muted", `Valid for ${minutes} minutes`),
    actions,
  );
}

function showNotInKandryn(): void {
  const actions = el("div", "actions");
  actions.append(externalLink("Open Kandryn", kandrynBase()));
  actions.append(button("Check again", () => void load()));
  render(el("p", "msg", "This issue has not been imported into Kandryn."), actions);
}

function showReady(v: ReadyView): void {
  const nodes: Node[] = [];

  if (v.confidence) {
    // Amber when the confidence gate would park this plan for review. The
    // threshold itself lives on the project, so the server sends the verdict
    // as a label rather than making the panel re-derive it.
    const tone: Tone = v.confidence.label === "ok" ? "neutral" : "amber";
    nodes.push(row("Confidence", lozenge(v.confidence.score.toFixed(2), tone)));
  }

  if (v.order.status === "warning" && v.order.blockers.length > 0) {
    const wrap = el("div");
    wrap.append(lozenge("Run after", "amber"));
    const keys = v.order.blockers.map((b) => b.key).join(", ");
    const more = v.order.moreCount > 0 ? ` and ${v.order.moreCount} more` : "";
    wrap.append(el("div", "muted", `${keys}${more}`));
    nodes.push(row("Run order", wrap));
  } else if (v.order.status === "ok") {
    nodes.push(row("Run order", "No ordering issues"));
  }

  if (v.latestRun) {
    const wrap = el("div");
    wrap.append(lozenge(v.latestRun.status, runTone(v.latestRun.status)));
    wrap.append(el("div", "muted", `Started ${shortTime(v.latestRun.startedAt)}`));
    if (v.latestRun.prUrl) {
      const prWrap = el("div");
      prWrap.append(externalLink("View pull request", v.latestRun.prUrl));
      wrap.append(prWrap);
    }
    nodes.push(row("Latest run", wrap));
  } else {
    nodes.push(row("Latest run", "No runs yet"));
  }

  const actions = el("div", "actions");
  actions.append(externalLink("Open in Kandryn", v.links.openInKandryn));
  actions.append(button("Refresh", () => void load()));
  nodes.push(actions);

  // Degraded last: the sections above are real, and this explains the gaps
  // rather than replacing them.
  if (v.degraded && v.degraded.length > 0) {
    nodes.push(el("div", "note", "Some details are unavailable right now."));
  }

  render(...nodes);
}

/** Where "Open Kandryn" points when there is no work item to deep-link to. */
function kandrynBase(): string {
  return "https://app.kandryn.com";
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

/**
 * The documented runtime shape of an invokeRemote response.
 *
 * `@forge/bridge` types the return as `Record<string, any> | void`, which is
 * looser than what the remote-invocation contract actually sends back
 * ({headers, status, body}). The gap is bridged HERE, once, so no call site
 * casts and nothing downstream has to guess — and because the type is only a
 * promise, `status` is checked at runtime rather than trusted.
 */
interface RemoteResponse {
  status: number;
  body?: unknown;
}

async function callRemote(path: string, method: "GET" | "POST"): Promise<RemoteResponse | null> {
  const res = (await invokeRemote({ path, method })) as Partial<RemoteResponse> | void;
  if (!res || typeof res.status !== "number") return null;
  return { status: res.status, body: res.body };
}


async function getCode(): Promise<void> {
  showLoading();
  try {
    const res = await callRemote(`${API}/link/start`, "POST");
    const body = res?.body as { code?: string; expiresInSeconds?: number; pageUrl?: string } | undefined;
    if (res?.status !== 200 || !body?.code || !body.pageUrl) {
      showError();
      return;
    }
    showCode(body.code, body.expiresInSeconds ?? 600, body.pageUrl);
  } catch {
    showError();
  }
}

async function load(): Promise<void> {
  showLoading();
  try {
    const context = await view.getContext();
    // Not trusted for authorization — see the note at the top of this file.
    // It is a lookup term, and the server scopes the lookup itself.
    const extension = (context as { extension?: { issue?: { key?: string; id?: string } } }).extension;
    const key = extension?.issue?.key;
    const issueId = extension?.issue?.id;
    if (!key) {
      showError();
      return;
    }

    const query = new URLSearchParams({ key });
    // Sent for the contract's sake; phase 1 matches on the key, because
    // Kandryn stores the Jira key and not the numeric id.
    if (issueId && /^\d{1,20}$/.test(issueId)) query.set("issueId", issueId);

    const res = await callRemote(`${API}/issue?${query.toString()}`, "GET");
    if (res?.status !== 200) {
      // 403 (installation disabled) and 503 (feature off) both land here. The
      // panel says the same thing for each: nothing a Jira user can act on.
      showError();
      return;
    }

    const v = res.body as IssueView | undefined;
    switch (v?.state) {
      case "not_linked":
        showNotLinked();
        return;
      case "not_in_kandryn":
        showNotInKandryn();
        return;
      case "ready":
        showReady(v);
        return;
      default:
        showError();
    }
  } catch {
    showError();
  }
}

void load();
