import { Router, type IRouter } from "express";
import { and, eq, or } from "drizzle-orm";
import { z } from "zod/v4";
import { db, knowledgeChunksTable, knowledgeSourcesTable, projectsTable } from "@workspace/db";
import { canAdminister } from "../services/resourceAdmin.js";
import * as audit from "../services/auditService.js";
import {
  containsPrivateKey,
  parseDocument,
  DocumentParseError,
} from "../services/documentParser.js";
import {
  StorageNotConfiguredError,
  UPLOAD_URL_TTL_SECONDS,
  buildStoragePath,
  createSignedUploadUrl,
  deleteObject,
  downloadObject,
  isStorageConfigured,
  sha256,
} from "../services/knowledgeStorage.js";

/**
 * Project knowledge documents (0041).
 *
 * Reference material, not authority: what a run retrieves from here is
 * background, and the work item's acceptance criteria govern. Nothing in this
 * file or its UI calls a document a rule.
 *
 * Access follows the rules already in projects.ts rather than inventing a
 * third: READING the list uses the same test as `GET /projects` (owner, or a
 * team member of a team-visible project), so a team sees what its runs are
 * using; WRITING uses `canAdminister`, which falls back to ownership on a
 * personal project so a solo user is never locked out of their own documents.
 */

const router: IRouter = Router();

const ProjectParam = z.object({ id: z.coerce.number().int().positive() });
const SourceParams = z.object({
  id: z.coerce.number().int().positive(),
  sourceId: z.coerce.number().int().positive(),
});

const DOC_TYPES = ["architecture", "requirements", "design", "other"] as const;
const ALLOWED_EXTENSIONS = ["md", "txt", "csv", "pdf", "docx"] as const;
const MAX_SIZE_BYTES = 15 * 1024 * 1024;
const MAX_SOURCES_PER_PROJECT = 25;
/** A source that never completed is shown as failed after this long. */
const STALE_AFTER_MS = 30 * 60 * 1000;

const UploadRequest = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  docType: z.enum(DOC_TYPES),
  title: z.string().min(1).max(200).optional(),
});

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

type Actor = { userId: string; teamId?: number | null; teamRole?: string | null };

/** The project, if the caller may READ it. Null means answer 404. */
async function readableProject(actor: Actor, projectId: number) {
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(
      and(
        eq(projectsTable.id, projectId),
        or(
          eq(projectsTable.userId, actor.userId),
          and(eq(projectsTable.teamId, actor.teamId ?? -1), eq(projectsTable.visibility, "team")),
        ),
      ),
    );
  return project ?? null;
}

function canWrite(actor: Actor, project: { userId: string; teamId: number | null }): boolean {
  return (
    project.userId === actor.userId ||
    canAdminister(
      { userId: actor.userId, teamId: actor.teamId ?? null, teamRole: actor.teamRole ?? null },
      { ownerUserId: project.userId, teamId: project.teamId },
    )
  );
}

const actorOf = (req: { userId: string; teamId?: number | null; teamRole?: string | null }): Actor => ({
  userId: req.userId,
  teamId: req.teamId ?? null,
  teamRole: req.teamRole ?? null,
});

/** A source's effective status, with a never-completed upload read as failed. */
function effectiveStatus(row: typeof knowledgeSourcesTable.$inferSelect): {
  status: string;
  error: string | null;
} {
  if (row.status === "pending" || row.status === "parsing") {
    if (Date.now() - row.createdAt.getTime() > STALE_AFTER_MS) {
      return { status: "failed", error: "The upload did not finish. Try again." };
    }
  }
  return { status: row.status, error: row.error };
}

// ---------------------------------------------------------------------------
// GET /projects/:id/knowledge — the list (never chunk text)
// ---------------------------------------------------------------------------

router.get("/projects/:id/knowledge", async (req, res): Promise<void> => {
  const params = ProjectParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const project = await readableProject(actorOf(req), params.data.id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const rows = await db
    .select()
    .from(knowledgeSourcesTable)
    .where(
      and(
        eq(knowledgeSourcesTable.userId, project.userId),
        eq(knowledgeSourcesTable.projectId, project.id),
      ),
    )
    .orderBy(knowledgeSourcesTable.createdAt);

  res.json({
    storageConfigured: isStorageConfigured(),
    canUpload: canWrite(actorOf(req), project),
    sources: rows.map((r) => ({
      id: r.id,
      title: r.title,
      docType: r.docType,
      fileName: r.fileName,
      sizeBytes: r.sizeBytes,
      chunkCount: r.chunkCount,
      createdAt: r.createdAt,
      ...effectiveStatus(r),
    })),
  });
});

// ---------------------------------------------------------------------------
// POST /projects/:id/knowledge/uploads — mint a signed URL
// ---------------------------------------------------------------------------

router.post("/projects/:id/knowledge/uploads", async (req, res): Promise<void> => {
  const params = ProjectParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const parsed = UploadRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid upload request", details: z.treeifyError(parsed.error) });
    return;
  }
  // Order matters: access first, then what the request says about the file,
  // and only then whether this deploy can store it. A 503 ahead of the access
  // check would tell a caller who cannot see the project that its storage is
  // unconfigured, and a 503 ahead of validation would hide a bad file behind
  // a capability message.
  const project = await readableProject(actorOf(req), params.data.id);
  if (!project || !canWrite(actorOf(req), project)) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const { fileName, mimeType, sizeBytes, docType, title } = parsed.data;
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext as (typeof ALLOWED_EXTENSIONS)[number])) {
    res.status(400).json({ error: "Upload a .md, .txt, .csv, .pdf or .docx file." });
    return;
  }
  if (sizeBytes > MAX_SIZE_BYTES) {
    res.status(400).json({ error: "That file is larger than 15 MB." });
    return;
  }

  const existing = await db
    .select({ id: knowledgeSourcesTable.id })
    .from(knowledgeSourcesTable)
    .where(
      and(
        eq(knowledgeSourcesTable.userId, project.userId),
        eq(knowledgeSourcesTable.projectId, project.id),
      ),
    );
  if (existing.length >= MAX_SOURCES_PER_PROJECT) {
    res.status(400).json({ error: `A project can hold ${MAX_SOURCES_PER_PROJECT} documents. Remove one first.` });
    return;
  }

  if (!isStorageConfigured()) {
    res.status(503).json({ error: "Document storage is not configured." });
    return;
  }

  const storagePath = buildStoragePath(project.userId, project.id, fileName);
  let uploadUrl: string;
  try {
    uploadUrl = await createSignedUploadUrl(storagePath);
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) {
      res.status(503).json({ error: err.message });
      return;
    }
    throw err;
  }

  const [source] = await db
    .insert(knowledgeSourcesTable)
    .values({
      userId: project.userId,
      projectId: project.id,
      docType,
      title: title?.trim() || fileName,
      fileName,
      mimeType,
      sizeBytes,
      storagePath,
      status: "pending",
    })
    .returning();

  res.status(201).json({ sourceId: source.id, uploadUrl, expiresIn: UPLOAD_URL_TTL_SECONDS });
});

// ---------------------------------------------------------------------------
// POST /projects/:id/knowledge/uploads/:sourceId/complete — verify, parse, index
// ---------------------------------------------------------------------------

router.post("/projects/:id/knowledge/uploads/:sourceId/complete", async (req, res): Promise<void> => {
  const params = SourceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const project = await readableProject(actorOf(req), params.data.id);
  if (!project || !canWrite(actorOf(req), project)) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const [source] = await db
    .select()
    .from(knowledgeSourcesTable)
    .where(
      and(
        eq(knowledgeSourcesTable.id, params.data.sourceId),
        eq(knowledgeSourcesTable.userId, project.userId),
        eq(knowledgeSourcesTable.projectId, project.id),
      ),
    );
  if (!source) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  /** Mark the source failed, bin the object, and answer. Never leaks text. */
  const fail = async (status: number, message: string): Promise<void> => {
    await db
      .update(knowledgeSourcesTable)
      .set({ status: "failed", error: message, chunkCount: 0 })
      .where(eq(knowledgeSourcesTable.id, source.id));
    await db.delete(knowledgeChunksTable).where(eq(knowledgeChunksTable.sourceId, source.id));
    await deleteObject(source.storagePath);
    res.status(status).json({ error: message });
  };

  await db.update(knowledgeSourcesTable).set({ status: "parsing", error: null }).where(eq(knowledgeSourcesTable.id, source.id));

  let bytes: Buffer;
  try {
    bytes = await downloadObject(source.storagePath);
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) {
      res.status(503).json({ error: err.message });
      return;
    }
    await fail(400, "The uploaded file could not be read. Try uploading it again.");
    return;
  }

  if (bytes.length > MAX_SIZE_BYTES) {
    await fail(400, "That file is larger than 15 MB.");
    return;
  }

  // The secret check runs on the raw bytes too, so an armoured key inside a
  // container we cannot parse is still refused.
  if (containsPrivateKey(bytes.toString("latin1"))) {
    await fail(
      400,
      "That document appears to contain a private key. It was not stored. Remove the credential and upload it again.",
    );
    return;
  }

  let result;
  try {
    result = await parseDocument(bytes, source.fileName);
  } catch (err) {
    if (err instanceof DocumentParseError) {
      await fail(400, err.message);
      return;
    }
    // An unexpected failure must not leave a half-indexed document behind.
    req.log.warn({ sourceId: source.id }, "Knowledge document parsing failed unexpectedly");
    await fail(500, "That document could not be processed.");
    return;
  }

  const hash = sha256(bytes);
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(knowledgeSourcesTable)
        .set({
          status: "ready",
          error: result.warning,
          contentHash: hash,
          chunkCount: result.chunks.length,
          parsedAt: new Date(),
        })
        .where(eq(knowledgeSourcesTable.id, source.id));
      await tx.insert(knowledgeChunksTable).values(
        result.chunks.map((c) => ({
          sourceId: source.id,
          userId: project.userId,
          projectId: project.id,
          seq: c.seq,
          heading: c.heading,
          page: c.page,
          text: c.text,
        })),
      );
    });
  } catch (err) {
    // Drizzle wraps the driver error, so the SQLSTATE is on err.cause.
    const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") {
      const [dup] = await db
        .select({ id: knowledgeSourcesTable.id, title: knowledgeSourcesTable.title })
        .from(knowledgeSourcesTable)
        .where(
          and(
            eq(knowledgeSourcesTable.projectId, project.id),
            eq(knowledgeSourcesTable.contentHash, hash),
          ),
        );
      await db.delete(knowledgeSourcesTable).where(eq(knowledgeSourcesTable.id, source.id));
      await deleteObject(source.storagePath);
      res.status(409).json({
        error: "That document is already in this project.",
        existingSourceId: dup?.id,
        existingTitle: dup?.title,
      });
      return;
    }
    throw err;
  }

  // Fire-and-forget, and metadata only — never a word of the document.
  audit.log({
    userId: req.userId,
    teamId: req.teamId ?? null,
    action: "knowledge.source_added",
    entityType: "knowledge_source",
    entityId: source.id,
    metadata: {
      sourceId: source.id,
      docType: source.docType,
      fileName: source.fileName,
      sizeBytes: source.sizeBytes,
    },
    ipAddress: audit.getIp(req),
    userAgent: req.headers["user-agent"],
  });

  res.json({
    id: source.id,
    status: "ready",
    chunkCount: result.chunks.length,
    error: result.warning,
  });
});

// ---------------------------------------------------------------------------
// DELETE /projects/:id/knowledge/:sourceId
// ---------------------------------------------------------------------------

router.delete("/projects/:id/knowledge/:sourceId", async (req, res): Promise<void> => {
  const params = SourceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const project = await readableProject(actorOf(req), params.data.id);
  if (!project || !canWrite(actorOf(req), project)) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const [source] = await db
    .select()
    .from(knowledgeSourcesTable)
    .where(
      and(
        eq(knowledgeSourcesTable.id, params.data.sourceId),
        eq(knowledgeSourcesTable.userId, project.userId),
        eq(knowledgeSourcesTable.projectId, project.id),
      ),
    );
  if (!source) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  await deleteObject(source.storagePath);
  // Chunks go by cascade.
  await db.delete(knowledgeSourcesTable).where(eq(knowledgeSourcesTable.id, source.id));

  audit.log({
    userId: req.userId,
    teamId: req.teamId ?? null,
    action: "knowledge.source_deleted",
    entityType: "knowledge_source",
    entityId: source.id,
    metadata: {
      sourceId: source.id,
      docType: source.docType,
      fileName: source.fileName,
      sizeBytes: source.sizeBytes,
    },
    ipAddress: audit.getIp(req),
    userAgent: req.headers["user-agent"],
  });

  res.status(204).end();
});

export default router;
