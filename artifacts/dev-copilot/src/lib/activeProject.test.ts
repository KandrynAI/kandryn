import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveActiveProject, projectRouteId, RESOURCE_ROUTE_RE } from "./activeProject.js";

const projects = [{ id: 4, name: "PinnacleCube" }, { id: 5, name: "PnC Insurance Demo" }];

// The active-project derivation is the single rule every route relies on. These
// lock the priority so a resource's project can never be masked by stale state.

test("resource project beats a stale stored project", () => {
  // The exact run #21 scenario: last-visited project 4 in storage, but the
  // resource being viewed belongs to project 5.
  const p = resolveActiveProject(projects, { routeId: null, resourceProjectId: 5, storedProjectId: 4 });
  assert.equal(p?.id, 5);
});

test("an explicit /p/:id URL beats everything", () => {
  const p = resolveActiveProject(projects, { routeId: 4, resourceProjectId: 5, storedProjectId: 5 });
  assert.equal(p?.id, 4);
});

test("falls back to stored when no route and no resource (e.g. /settings)", () => {
  // After leaving a resource page the override is cleared → stored wins again.
  const p = resolveActiveProject(projects, { routeId: null, resourceProjectId: null, storedProjectId: 4 });
  assert.equal(p?.id, 4);
});

test("falls back to the first project when nothing is known", () => {
  const p = resolveActiveProject(projects, {});
  assert.equal(p?.id, 4);
});

test("null selectors never match a project (no id === null)", () => {
  const withNullId = [{ id: 7, name: "X" }];
  assert.equal(resolveActiveProject(withNullId, { resourceProjectId: null, storedProjectId: null })?.id, 7);
});

test("returns null only when the user has no projects", () => {
  assert.equal(resolveActiveProject([], { resourceProjectId: 5 }), null);
});

test("an unknown resource/stored id is ignored, not selected", () => {
  const p = resolveActiveProject(projects, { resourceProjectId: 999, storedProjectId: 5 });
  assert.equal(p?.id, 5);
});

test("projectRouteId parses /p/:id and ignores other routes", () => {
  assert.equal(projectRouteId("/p/4/board"), 4);
  assert.equal(projectRouteId("/p/12/runs"), 12);
  assert.equal(projectRouteId("/runs/21"), null);
  assert.equal(projectRouteId("/repositories/3"), null);
  assert.equal(projectRouteId("/settings"), null);
});

test("RESOURCE_ROUTE_RE flags the un-prefixed resource routes (the guard's trigger)", () => {
  // These lack /p/:id, so a page here MUST call useActiveProjectFromResource.
  assert.ok(RESOURCE_ROUTE_RE.test("/runs/21"));
  assert.ok(RESOURCE_ROUTE_RE.test("/runs/21/report"));
  assert.ok(RESOURCE_ROUTE_RE.test("/repositories/3"));
  // Project-scoped and generic routes are not flagged.
  assert.ok(!RESOURCE_ROUTE_RE.test("/p/4/board"));
  assert.ok(!RESOURCE_ROUTE_RE.test("/settings"));
  assert.ok(!RESOURCE_ROUTE_RE.test("/dashboard"));
});
