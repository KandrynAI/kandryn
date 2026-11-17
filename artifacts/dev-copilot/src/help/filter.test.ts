import { test } from "node:test";
import assert from "node:assert/strict";
import { filterSections, isRedirectedHref, resolveHref, sectionText } from "./filter.ts";
import type { HelpSection } from "./content.ts";

const SECTIONS: HelpSection[] = [
  { id: "a", title: "The board", intro: "Columns and filters", steps: ["Click \"Sync\""] },
  { id: "b", title: "Runbooks", steps: ["Pick a target"], watchFor: "Nothing is published automatically" },
  {
    id: "c",
    title: "When something fails",
    troubles: [{ message: "\"Not set\"", meaning: "Never saved", fix: "Open Settings" }],
  },
  { id: "d", title: "Glossary", terms: [{ term: "Run", definition: "One pass of the pipeline" }] },
];

test("an empty query returns everything, so clearing the box restores the guide", () => {
  assert.equal(filterSections(SECTIONS, "").length, SECTIONS.length);
  assert.equal(filterSections(SECTIONS, "   ").length, SECTIONS.length);
});

test("a query matches titles and step text, ignoring case", () => {
  assert.deepEqual(filterSections(SECTIONS, "BOARD").map((s) => s.id), ["a"]);
  assert.deepEqual(filterSections(SECTIONS, "sync").map((s) => s.id), ["a"]);
});

test("the failure table and the glossary are searchable", () => {
  // Someone searching an error they are staring at is the likeliest use of the
  // box, so the section written for that moment must not be invisible to it.
  assert.deepEqual(filterSections(SECTIONS, "not set").map((s) => s.id), ["c"]);
  assert.deepEqual(filterSections(SECTIONS, "pipeline").map((s) => s.id), ["d"]);
});

test("a watch-for note is searchable", () => {
  assert.deepEqual(filterSections(SECTIONS, "automatically").map((s) => s.id), ["b"]);
});

test("every word must match, in any order", () => {
  assert.deepEqual(filterSections(SECTIONS, "board columns").map((s) => s.id), ["a"]);
  assert.deepEqual(filterSections(SECTIONS, "columns board").map((s) => s.id), ["a"]);
  // Adding a word may never widen the result set.
  assert.deepEqual(filterSections(SECTIONS, "board runbooks"), []);
});

test("no match is an empty list, not everything", () => {
  assert.deepEqual(filterSections(SECTIONS, "kubernetes"), []);
});

test("sectionText folds every field a reader can see", () => {
  const text = sectionText(SECTIONS[2]);
  assert.ok(text.includes("when something fails"));
  assert.ok(text.includes("open settings"));
});

test("a project-scoped href is filled in from the active project", () => {
  assert.equal(resolveHref("/p/{projectId}/board", 7), "/p/7/board");
  assert.equal(resolveHref("/p/{projectId}/settings?tab=knowledge", 7), "/p/7/settings?tab=knowledge");
});

test("with no project, a project-scoped link goes where the reader needs to go next", () => {
  assert.equal(resolveHref("/p/{projectId}/board", null), "/projects/new");
  assert.ok(isRedirectedHref("/p/{projectId}/board", null));
});

test("a link with no token is untouched, and never marked redirected", () => {
  assert.equal(resolveHref("/settings?tab=team", null), "/settings?tab=team");
  assert.equal(isRedirectedHref("/settings?tab=team", null), false);
  assert.equal(isRedirectedHref("/p/{projectId}/board", 7), false);
});
