/**
 * The pure half of the help page: filtering, outline and link resolution.
 *
 * Separate from HelpPage.tsx for the reason lib/runTimeline.ts and
 * lib/knowledgeQueue.ts are separate from their components: the dev-copilot
 * test runner strips types but does not compile JSX, so logic inside a .tsx
 * cannot be tested at all.
 */

import type { HelpSection } from "./content.ts";

/** The project id token a project-scoped href carries until render time. */
export const PROJECT_TOKEN = "{projectId}";

/**
 * Everything in a section a reader might search for, lowercased.
 *
 * Titles AND step text, per the brief. Troubles and glossary terms are in here
 * too: someone searching for an error they are looking at right now is the
 * single most likely use of this box, and it would be strange for the one
 * section written for that moment to be the one the filter cannot see.
 */
export function sectionText(section: HelpSection): string {
  const parts: string[] = [section.title];
  if (section.intro) parts.push(section.intro);
  if (section.steps) parts.push(...section.steps);
  if (section.watchFor) parts.push(section.watchFor);
  if (section.troubles) {
    for (const t of section.troubles) parts.push(t.message, t.meaning, t.fix);
  }
  if (section.terms) {
    for (const t of section.terms) parts.push(t.term, t.definition);
  }
  return parts.join(" ").toLowerCase();
}

/**
 * Sections matching every whitespace-separated word of the query, in any order
 * and anywhere in the section. All words rather than any, because a two-word
 * query narrowing to MORE results reads as broken.
 *
 * An empty or whitespace-only query returns the list unchanged, so clearing the
 * box always restores the full guide.
 */
export function filterSections(sections: HelpSection[], query: string): HelpSection[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return sections;
  return sections.filter((section) => {
    const text = sectionText(section);
    return words.every((word) => text.includes(word));
  });
}

/**
 * Fill in a section's href for the project the reader is working in.
 *
 * With no active project there is nothing sensible to link a board or a runs
 * list to, so a project-scoped link becomes the new-project wizard: the thing
 * that reader actually needs next. A link with no token is returned untouched.
 */
export function resolveHref(href: string, projectId: number | null): string {
  if (!href.includes(PROJECT_TOKEN)) return href;
  if (projectId == null) return "/projects/new";
  return href.replace(PROJECT_TOKEN, String(projectId));
}

/** True when the link would land somewhere other than the screen it names. */
export function isRedirectedHref(href: string, projectId: number | null): boolean {
  return href.includes(PROJECT_TOKEN) && projectId == null;
}
