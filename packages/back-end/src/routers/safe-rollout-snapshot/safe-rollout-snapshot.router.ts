import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import { safeRolloutRule } from "back-end/src/validators/features";
import * as rawSnapshotController from "./safe-rollout-snapshot.controller";

const router = express.Router();

const safeRolloutSnapshotController = wrapController(rawSnapshotController);

const snapshotParams = z.object({ id: z.string() }).strict();

// Get the latest snapshot for a safe rollout rule
router.get(
  "/:id/latest",
  validateRequestMiddleware({
    params: snapshotParams,
  }),
  safeRolloutSnapshotController.getLatestSnapshot
);

// Create a snapshot for a safe rollout rule
router.post(
  "/",
  validateRequestMiddleware({
    body: safeRolloutRule,
  }),
  safeRolloutSnapshotController.createSnapshot
);

// Cancel a running snapshot for a safe rollout rule
router.put(
  "/:id/cancel",
  validateRequestMiddleware({
    params: snapshotParams,
  }),
  safeRolloutSnapshotController.cancelSnapshot
);

export { router as safeRolloutSnapshotRouter };
