/**
 * The upload queue's logic, with no React and no JSX in it.
 *
 * It lives here because the dev-copilot test runner strips types but does not
 * compile JSX, so a `.tsx` cannot be tested at all. Validation, the state
 * machine and the sort are exactly the parts worth pinning: a queue that
 * cancels good files because one was bad, or a concurrency bound that drifts,
 * is the kind of fault you only notice with five files in flight.
 */

export type KnowledgeDocType = 'architecture' | 'requirements' | 'design' | 'other';

export const ALLOWED_EXTENSIONS = ['md', 'txt', 'csv', 'pdf', 'docx'] as const;
export const MAX_SIZE_BYTES = 15 * 1024 * 1024;
export const MAX_SOURCES_PER_PROJECT = 25;
/** Parallel uploads. Enough to feel immediate, few enough to stay orderly. */
export const MAX_CONCURRENT_UPLOADS = 3;

export type QueueItemState = 'queued' | 'uploading' | 'processing' | 'done' | 'failed' | 'invalid';

export interface QueueItem {
  /** Stable within a session; the file itself is not a usable key. */
  id: string;
  file: File;
  fileName: string;
  sizeBytes: number;
  docType: KnowledgeDocType;
  title: string;
  state: QueueItemState;
  /** 0–100 while uploading. */
  progress: number;
  /** Why it is invalid or failed. Shown on the row. */
  error: string | null;
  /** The source id once the server has one, so a retry can clean up. */
  sourceId?: number;
}

export function extensionOf(fileName: string): string {
  const parts = fileName.split('.');
  return parts.length > 1 ? (parts.pop() ?? '').toLowerCase() : '';
}

/** The title a file gets by default: its name without the extension. */
export function defaultTitle(fileName: string): string {
  const ext = extensionOf(fileName);
  const stem = ext ? fileName.slice(0, -(ext.length + 1)) : fileName;
  return stem.trim() || fileName;
}

/** A file name shortened for display, keeping the extension legible. */
export function displayFileName(fileName: string, max = 32): string {
  if (fileName.length <= max) return fileName;
  const ext = extensionOf(fileName);
  const suffix = ext ? `.${ext}` : '';
  const keep = Math.max(4, max - suffix.length - 1);
  return `${fileName.slice(0, keep)}…${suffix}`;
}

export interface ValidateContext {
  /** File names already queued, to catch a double-pick. */
  queuedNames: string[];
  /** How many documents the project already holds. */
  existingCount: number;
  /** How many of this batch were accepted before this file. */
  acceptedSoFar: number;
}

/**
 * Why this file cannot be uploaded, or null if it can. One message, phrased
 * for the row it appears on.
 */
export function validateFile(
  file: { name: string; size: number },
  ctx: ValidateContext,
): string | null {
  const ext = extensionOf(file.name);
  if (!ALLOWED_EXTENSIONS.includes(ext as (typeof ALLOWED_EXTENSIONS)[number])) {
    return 'Unsupported file type. Use .md, .txt, .csv, .pdf or .docx.';
  }
  if (file.size > MAX_SIZE_BYTES) return 'Larger than 15 MB.';
  if (file.size === 0) return 'That file is empty.';
  if (ctx.queuedNames.includes(file.name)) return 'Already in the queue.';
  if (ctx.existingCount + ctx.acceptedSoFar >= MAX_SOURCES_PER_PROJECT) {
    return `Limit of ${MAX_SOURCES_PER_PROJECT} documents reached.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The queue reducer
// ---------------------------------------------------------------------------

export type QueueAction =
  | { type: 'add'; files: File[]; docType: KnowledgeDocType; existingCount: number }
  | { type: 'remove'; id: string }
  | { type: 'setDocType'; id: string; docType: KnowledgeDocType }
  | { type: 'setDocTypeAll'; docType: KnowledgeDocType }
  | { type: 'setTitle'; id: string; title: string }
  | { type: 'start'; id: string; sourceId?: number }
  | { type: 'progress'; id: string; progress: number }
  | { type: 'processing'; id: string }
  | { type: 'done'; id: string }
  | { type: 'failed'; id: string; error: string }
  | { type: 'retry'; id: string }
  | { type: 'clearFinished' };

let seq = 0;
const nextId = () => `q${++seq}`;

/** Only these states occupy a slot against MAX_CONCURRENT_UPLOADS. */
export function inFlightCount(items: QueueItem[]): number {
  return items.filter((i) => i.state === 'uploading' || i.state === 'processing').length;
}

/** The next items to start, never exceeding the concurrency bound. */
export function nextToStart(items: QueueItem[]): QueueItem[] {
  const free = MAX_CONCURRENT_UPLOADS - inFlightCount(items);
  if (free <= 0) return [];
  return items.filter((i) => i.state === 'queued').slice(0, free);
}

/** Whether "Upload N files" should be enabled, and the N it shows. */
export function uploadableCount(items: QueueItem[]): number {
  return items.filter((i) => i.state === 'queued').length;
}

export function queueReducer(items: QueueItem[], action: QueueAction): QueueItem[] {
  const map = (id: string, patch: (i: QueueItem) => QueueItem) =>
    items.map((i) => (i.id === id ? patch(i) : i));

  switch (action.type) {
    case 'add': {
      // Validation is per file and cumulative, so the cap counts what this
      // batch has already accepted — and one bad file never stops the rest.
      const queuedNames = items.map((i) => i.fileName);
      // Items that are on their way to becoming documents. An invalid or
      // failed row is not one, so it does not eat a slot against the cap.
      const willCount = (list: QueueItem[]) =>
        list.filter((i) => i.state !== 'invalid' && i.state !== 'failed').length;
      const added: QueueItem[] = [];
      for (const file of action.files) {
        const error = validateFile(file, {
          queuedNames: [...queuedNames, ...added.map((a) => a.fileName)],
          existingCount: action.existingCount + willCount(items),
          acceptedSoFar: willCount(added),
        });
        added.push({
          id: nextId(),
          file,
          fileName: file.name,
          sizeBytes: file.size,
          docType: action.docType,
          title: defaultTitle(file.name),
          state: error ? 'invalid' : 'queued',
          progress: 0,
          error,
        });
      }
      return [...items, ...added];
    }
    case 'remove':
      return items.filter((i) => i.id !== action.id);
    case 'setDocType':
      return map(action.id, (i) => ({ ...i, docType: action.docType }));
    case 'setDocTypeAll':
      // A row can still be overridden afterwards; this only sets the ones a
      // user has not finished with.
      return items.map((i) =>
        i.state === 'queued' || i.state === 'invalid' || i.state === 'failed'
          ? { ...i, docType: action.docType }
          : i,
      );
    case 'setTitle':
      return map(action.id, (i) => ({ ...i, title: action.title }));
    case 'start':
      return map(action.id, (i) => ({
        ...i,
        state: 'uploading',
        progress: 0,
        error: null,
        sourceId: action.sourceId ?? i.sourceId,
      }));
    case 'progress':
      return map(action.id, (i) => ({ ...i, progress: Math.max(0, Math.min(100, action.progress)) }));
    case 'processing':
      return map(action.id, (i) => ({ ...i, state: 'processing', progress: 100 }));
    case 'done':
      return map(action.id, (i) => ({ ...i, state: 'done', progress: 100, error: null }));
    case 'failed':
      // A failed row STAYS, so it can be retried or removed deliberately.
      return map(action.id, (i) => ({ ...i, state: 'failed', error: action.error }));
    case 'retry':
      return map(action.id, (i) => ({ ...i, state: 'queued', progress: 0, error: null, sourceId: undefined }));
    case 'clearFinished':
      // Done rows have moved into the table; failures stay behind.
      return items.filter((i) => i.state !== 'done');
    default:
      return items;
  }
}

// ---------------------------------------------------------------------------
// Table sorting
// ---------------------------------------------------------------------------

export type SortKey = 'title' | 'docType' | 'sizeBytes' | 'createdAt';
export type SortDir = 'asc' | 'desc';

export interface SortableSource {
  id: number;
  title: string;
  docType: string;
  sizeBytes: number;
  createdAt: string;
}

/**
 * Sort a copy, newest first by default. Ties fall back to id so the order is
 * stable — two documents added in the same second must not swap places on
 * every poll.
 */
export function sortSources<T extends SortableSource>(rows: T[], key: SortKey, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    let cmp = 0;
    if (key === 'sizeBytes') cmp = a.sizeBytes - b.sizeBytes;
    else if (key === 'createdAt') cmp = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    else cmp = String(a[key]).localeCompare(String(b[key]), undefined, { sensitivity: 'base' });
    if (cmp !== 0) return cmp * sign;
    return a.id - b.id;
  });
}
