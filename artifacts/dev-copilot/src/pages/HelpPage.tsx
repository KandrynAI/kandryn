import { useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Search, X } from "lucide-react";
import { useActiveProject } from "@/context/ActiveProjectContext";
import { HELP_INTRO, HELP_SECTIONS, QUICK_START, type HelpSection } from "@/help/content";
import { filterSections, isRedirectedHref, resolveHref } from "@/help/filter";

/**
 * The in-app guide, for the person who executes runs.
 *
 * Static content from src/help/content.ts, rendered here. Everything testable
 * lives in src/help/filter.ts; this file owns markup, scrolling and the one
 * piece of state (the filter box).
 *
 * There is no loading or error state because there is nothing to load: the
 * content ships in the bundle. The only empty state possible is a filter that
 * matches nothing, which is handled below.
 */
export default function HelpPage() {
  const [query, setQuery] = useState("");
  const [, navigate] = useLocation();
  const { activeProject } = useActiveProject();
  const projectId = activeProject?.id ?? null;
  const bodyRef = useRef<HTMLDivElement>(null);

  const sections = useMemo(() => filterSections(HELP_SECTIONS, query), [query]);
  const filtering = query.trim().length > 0;

  /**
   * Scroll to a section. The app's scroll container is <main>, not the window,
   * so a hash link would move the wrong thing (or nothing). scrollIntoView
   * finds the right ancestor by itself.
   */
  const goTo = (id: string) => {
    bodyRef.current?.querySelector(`#help-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const openScreen = (href: string) => navigate(resolveHref(href, projectId));

  return (
    <>
      <style>{`
        .hp-root { display: flex; gap: 28px; align-items: flex-start;
          max-width: 1060px; margin: 0 auto; padding: 22px 24px 72px; }
        .hp-outline { width: 216px; min-width: 216px; position: sticky; top: 0;
          align-self: flex-start; padding-top: 2px; }
        .hp-narrow { display: none; }
        .hp-body { flex: 1; min-width: 0; }

        .hp-label { font-size: var(--fs-xs); font-weight: 600; color: var(--c-ink-4);
          text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; }

        .hp-find { display: flex; align-items: center; gap: 6px; width: 100%;
          height: 30px; padding: 0 8px; margin-bottom: 14px;
          border: 1px solid var(--c-border); border-radius: 6px;
          background: var(--c-surface); color: var(--c-ink-4); }
        .hp-find input { flex: 1; min-width: 0; border: none; outline: none; background: none;
          font-family: var(--sans); font-size: var(--fs-sm); color: var(--c-ink); }
        .hp-find input::placeholder { color: var(--c-ink-4); }
        .hp-clear { border: none; background: none; cursor: pointer; color: var(--c-ink-4);
          display: flex; align-items: center; padding: 0; }
        .hp-clear:hover { color: var(--c-ink-2); }

        .hp-link { display: block; width: 100%; text-align: left; border: none; background: none;
          cursor: pointer; font-family: var(--sans); font-size: var(--fs-sm);
          color: var(--c-ink-3); padding: 4px 6px; border-radius: 4px; line-height: 1.35; }
        .hp-link:hover { background: var(--c-raised); color: var(--c-ink); }
        .hp-select { width: 100%; height: 32px; padding: 0 8px; border-radius: 6px;
          border: 1px solid var(--c-border); background: var(--c-surface);
          color: var(--c-ink); font-family: var(--sans); font-size: var(--fs-sm); }

        .hp-h1 { font-size: var(--fs-xl); font-weight: 600; color: var(--c-ink); }
        .hp-intro { font-size: 13px; line-height: 1.6; color: var(--c-ink-3);
          margin-top: 6px; max-width: 64ch; }

        .hp-card { border: 1px solid var(--c-border); border-radius: 8px;
          background: var(--c-surface); padding: 16px 18px; margin-top: 20px; }
        .hp-sec { padding-top: 26px; scroll-margin-top: 12px; }
        .hp-h2 { font-size: var(--fs-md); font-weight: 600; color: var(--c-ink);
          display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .hp-tag { font-size: var(--fs-xs); font-weight: 600; letter-spacing: 0.06em;
          text-transform: uppercase; color: var(--c-ink-3); background: var(--c-raised);
          border: 1px solid var(--c-border-s); border-radius: 3px; padding: 1px 5px; }

        .hp-where { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;
          margin-top: 8px; font-size: 13px; color: var(--c-ink-4); }
        .hp-where button { border: none; background: none; padding: 0; cursor: pointer;
          font-family: var(--sans); font-size: 13px; color: var(--c-blue); }
        .hp-where button:hover { text-decoration: underline; }
        .hp-note { font-size: var(--fs-xs); color: var(--c-ink-4); }

        .hp-text { font-size: 13px; line-height: 1.6; color: var(--c-ink-3);
          margin-top: 8px; max-width: 72ch; }
        /* The app's CSS reset clears list markers, so the numbering the guide
           depends on has to be asked for again. */
        .hp-steps { margin: 10px 0 0; padding-left: 22px; max-width: 72ch; list-style: decimal outside; }
        .hp-steps::marker, .hp-steps li::marker { color: var(--c-ink-4); font-size: 12px; }
        .hp-steps li { font-size: 13px; line-height: 1.6; color: var(--c-ink-2);
          margin-bottom: 7px; }

        .hp-watch { margin-top: 12px; padding: 9px 12px; border-radius: 6px;
          background: var(--c-amber-bg); border: 1px solid var(--c-amber);
          font-size: 13px; line-height: 1.55; color: var(--c-ink-2); max-width: 72ch; }
        .hp-watch b { color: var(--c-amber); font-weight: 600; }

        .hp-table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        .hp-table th { text-align: left; font-size: var(--fs-xs); font-weight: 600;
          color: var(--c-ink-4); text-transform: uppercase; letter-spacing: 0.06em;
          padding: 0 10px 6px 0; border-bottom: 1px solid var(--c-border); }
        .hp-table td { font-size: 13px; line-height: 1.55; color: var(--c-ink-2);
          padding: 9px 10px 9px 0; border-bottom: 1px solid var(--c-border);
          vertical-align: top; }
        .hp-table td:first-child { color: var(--c-ink); }

        .hp-term { font-size: 13px; line-height: 1.6; color: var(--c-ink-2);
          padding: 7px 0; border-bottom: 1px solid var(--c-border); }
        .hp-term b { color: var(--c-ink); font-weight: 600; }

        .hp-empty { font-size: 13px; color: var(--c-ink-4); margin-top: 24px; }
        .hp-inline { border: none; background: none; padding: 0; cursor: pointer;
          font: inherit; color: var(--c-blue); }
        .hp-inline:hover { text-decoration: underline; }

        @media (max-width: 900px) {
          .hp-root { flex-direction: column; gap: 14px; padding: 18px 16px 64px; }
          .hp-outline { display: none; }
          .hp-narrow { display: block; width: 100%; }
        }
      `}</style>

      <div className="hp-root" data-testid="help-page">
        <aside className="hp-outline" aria-label="Guide outline">
          <Finder query={query} setQuery={setQuery} />
          <div className="hp-label">Contents</div>
          <button className="hp-link" onClick={() => goTo("quick-start")}>Quick start</button>
          {sections.map((s) => (
            <button key={s.id} className="hp-link" onClick={() => goTo(s.id)}>{s.title}</button>
          ))}
        </aside>

        <div className="hp-body" ref={bodyRef}>
          <h1 className="hp-h1">Using Kandryn</h1>
          <p className="hp-intro">{HELP_INTRO}</p>

          <div className="hp-narrow" style={{ marginTop: 14 }}>
            <Finder query={query} setQuery={setQuery} />
            <select
              className="hp-select"
              value=""
              aria-label="Jump to a section"
              onChange={(e) => { if (e.target.value) goTo(e.target.value); }}
            >
              <option value="">Jump to a section</option>
              <option value="quick-start">Quick start</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
          </div>

          {!filtering && (
            <section id="help-quick-start" className="hp-sec">
              <div className="hp-card" style={{ marginTop: 10 }}>
                <h2 className="hp-h2">Quick start</h2>
                <p className="hp-text" style={{ marginTop: 4 }}>
                  Sign-in to a reviewed pull request, in seven steps. Everything below is reference.
                </p>
                <ol className="hp-steps">
                  {QUICK_START.map((step) => <li key={step}>{step}</li>)}
                </ol>
              </div>
            </section>
          )}

          {sections.map((section) => (
            <Section
              key={section.id}
              section={section}
              projectId={projectId}
              onOpenScreen={openScreen}
            />
          ))}

          {sections.length === 0 && (
            <p className="hp-empty">
              No sections match that search.{" "}
              <button className="hp-inline" onClick={() => setQuery("")}>Clear it</button>{" "}
              to see the whole guide.
            </p>
          )}
        </div>
      </div>
    </>
  );
}

function Finder({ query, setQuery }: { query: string; setQuery: (v: string) => void }) {
  return (
    <div className="hp-find">
      <Search size={13} strokeWidth={1.75} />
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find in this guide"
        aria-label="Find in this guide"
      />
      {query && (
        <button className="hp-clear" onClick={() => setQuery("")} aria-label="Clear the search">
          <X size={13} strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}

function Section({
  section,
  projectId,
  onOpenScreen,
}: {
  section: HelpSection;
  projectId: number | null;
  onOpenScreen: (href: string) => void;
}) {
  const redirected = section.where ? isRedirectedHref(section.where.href, projectId) : false;
  return (
    <section id={`help-${section.id}`} className="hp-sec">
      <h2 className="hp-h2">
        {section.title}
        {section.admin && <span className="hp-tag">Admin</span>}
      </h2>

      {section.where && (
        <div className="hp-where">
          <span>Where you are:</span>
          <button onClick={() => onOpenScreen(section.where!.href)}>{section.where.label}</button>
          {redirected && <span className="hp-note">(opens the new-project wizard until you have a project)</span>}
        </div>
      )}

      {section.intro && <p className="hp-text">{section.intro}</p>}

      {section.steps && (
        <ol className="hp-steps">
          {section.steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
      )}

      {section.troubles && (
        <table className="hp-table">
          <thead>
            <tr><th>What you see</th><th>What it means</th><th>What to do</th></tr>
          </thead>
          <tbody>
            {section.troubles.map((t) => (
              <tr key={t.message}>
                <td>{t.message}</td>
                <td>{t.meaning}</td>
                <td>{t.fix}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {section.terms && (
        <div style={{ marginTop: 10, maxWidth: "72ch" }}>
          {section.terms.map((t) => (
            <div key={t.term} className="hp-term"><b>{t.term}.</b> {t.definition}</div>
          ))}
        </div>
      )}

      {section.watchFor && (
        <p className="hp-watch"><b>Watch for:</b> {section.watchFor}</p>
      )}
    </section>
  );
}
