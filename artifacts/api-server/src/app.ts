import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
// Use the named export: pino-http ships ESM-style types (`export default` +
// `export { PinoHttp as pinoHttp }`) on a CJS package, so the default import is
// not callable under nodenext resolution. The named export is callable in both
// bundler and nodenext modes (and the runtime sets module.exports.pinoHttp).
import { pinoHttp } from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware.js";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Clerk proxy must be mounted BEFORE body parsers (streams raw bytes)
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Resolve publishable key from request host so same server can serve multiple
// Clerk custom domains. Falls back to CLERK_PUBLISHABLE_KEY env var.
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
// TODO(serverless): The AI suggestion route (POST /api/tasks/:taskId/suggestions)
// is the most expensive endpoint — it fans out to Claude + OpenAI and then runs
// a synthesis call. It was previously protected by an in-memory express-rate-limit
// (20 req/min). That limiter is ineffective on Vercel: each serverless invocation
// gets fresh memory and many instances run concurrently, so per-process counters
// never accumulate. It has been removed for the migration. For now the endpoint is
// guarded only by Clerk auth (requireAuth). Before any heavy usage, add a
// serverless-safe limiter — e.g. a Supabase-backed per-user/time-window counter
// table checked at the top of the handler.

app.use("/api", router);

// ---------------------------------------------------------------------------
// Error handler — must be last and have 4 params for Express to recognise it
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  // Drizzle/pg unique-constraint violation — never surface the raw SQL. Drizzle
  // wraps the pg error, so the SQLSTATE is on err.cause.code, not err.code.
  const pgCode =
    (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
  const isDuplicate =
    pgCode === "23505" ||
    (err instanceof Error && err.message.includes("duplicate key value violates unique constraint"));
  if (isDuplicate) {
    logger.warn({ err, method: req.method, url: req.url }, "Unique constraint violation");
    res.status(409).json({ error: "A record with these details already exists." });
    return;
  }

  const message = err instanceof Error ? err.message : "Internal server error";
  const status =
    typeof (err as { status?: number }).status === "number"
      ? (err as { status: number }).status
      : 500;

  if (status >= 500) {
    logger.error({ err, method: req.method, url: req.url }, "Unhandled error");
  } else {
    logger.warn({ err, method: req.method, url: req.url }, "Request error");
  }

  res.status(status).json({ error: message });
});

export default app;
