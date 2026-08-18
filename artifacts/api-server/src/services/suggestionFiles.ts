import { asc, eq, inArray } from "drizzle-orm";
import { db, suggestionFilesTable, type SuggestionFileRow } from "@workspace/db";
import { primaryOf } from "./suggestionFilesUtil.js";

/** Load files for many suggestions at once, grouped by suggestion id (seq order). */
export async function loadFilesForSuggestions(
  ids: number[],
): Promise<Record<number, SuggestionFileRow[]>> {
  if (ids.length === 0) return {};
  const rows = await db
    .select()
    .from(suggestionFilesTable)
    .where(inArray(suggestionFilesTable.suggestionId, ids))
    .orderBy(asc(suggestionFilesTable.seq));
  const byId: Record<number, SuggestionFileRow[]> = {};
  for (const r of rows) (byId[r.suggestionId] ??= []).push(r);
  return byId;
}

/** Load a persisted suggestion's files, ordered by seq (Phase 0: one row). */
export async function loadSuggestionFiles(suggestionId: number): Promise<SuggestionFileRow[]> {
  return db
    .select()
    .from(suggestionFilesTable)
    .where(eq(suggestionFilesTable.suggestionId, suggestionId))
    .orderBy(asc(suggestionFilesTable.seq));
}

/**
 * The primary file (filePath + content) of a persisted suggestion — the single
 * file in Phase 0. Used by consumers that still operate on one file (commit,
 * Veria/Aegis/Narratia prompts, test generation).
 */
export async function suggestionPrimaryFile(
  suggestionId: number,
): Promise<{ filePath: string; code: string } | null> {
  const files = await loadSuggestionFiles(suggestionId);
  return primaryOf(files);
}
