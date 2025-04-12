import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawSnapshotController from "./safe-rollout-snapshot.controller";

const router = express.Router();

const safeRolloutSnapshotController = wrapController(rawSnapshotController);

const snapshotParams = z.object({ id: z.string() }).strict();

// Get the latest snapshot for a safe rollout rule
router.get(
  "/:id/snapshot",
  validateRequestMiddleware({
    params: snapshotParams,
  }),
  safeRolloutSnapshotController.getLatestSafeRolloutSnapshot
);

// Create a snapshot for a safe rollout rule
router.post(
  "/:id/snapshot",
  validateRequestMiddleware({
    params: snapshotParams,
    query: z.object({ force: z.string().optional() }).optional(),
  }),
  safeRolloutSnapshotController.postSafeRolloutSnapshot
);

// Cancel a running snapshot for a safe rollout rule
router.post(
  "/snapshot/:id/cancel",
  validateRequestMiddleware({
    params: snapshotParams,
  }),
  safeRolloutSnapshotController.cancelSafeRolloutSnapshot
);

export { router as safeRolloutSnapshotRouter };
