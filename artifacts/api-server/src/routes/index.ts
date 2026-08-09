import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import repositoriesRouter from "./repositories.js";
import tasksRouter from "./tasks.js";
import taskActionsRouter from "./taskActions.js";
import statsRouter from "./stats.js";
import configRouter from "./config.js";
import projectsRouter from "./projects.js";
import runsRouter from "./runs.js";
import workItemsRouter from "./workItems.js";
import testsRouter from "./tests.js";
import internalRouter from "./internal.js";
import waitlistRouter from "./waitlist.js";
import contactRouter from "./contact.js";
import teamsRouter from "./teams.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { attachTeam } from "../middlewares/team.js";

const router: IRouter = Router();

// Public routes (no auth) — must be mounted BEFORE requireAuth.
router.use(waitlistRouter);
router.use(contactRouter);
// Cron dispatcher — no Clerk auth; guarded by CRON_SECRET bearer inside.
router.use(internalRouter);

// All routes below require authentication (including health checks)
router.use(requireAuth);
// Attach the caller's team + role to every authenticated request (0017).
router.use(attachTeam);

router.use(healthRouter);
router.get("/health", (_req, res) => res.json({ status: "ok" }));

router.use(teamsRouter);

router.use(repositoriesRouter);
router.use(projectsRouter);
router.use(runsRouter);
router.use(workItemsRouter);
router.use(testsRouter);
router.use(tasksRouter);
router.use(taskActionsRouter);
router.use(statsRouter);
router.use(configRouter);

export default router;
