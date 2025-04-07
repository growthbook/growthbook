import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawSnapshotController from "./safe-rollout-snapshot.controller";
import { createSafeRolloutSnapshotValidator } from "./safe-rollout-snapshot.validators";

const router = express.Router();

const safeRolloutSnapshotController = wrapController(rawSnapshotController);

const snapshotParams = z.object({ id: z.string() }).strict();
const snapshotDimensionParams = z
  .object({ id: z.string(), dimension: z.string() })
  .strict();
// Get the latest snapshot for a safe rollout rule
router.get(
  "/:id/snapshot",
  validateRequestMiddleware({
    params: snapshotParams,
  }),
  safeRolloutSnapshotController.getLatestSnapshot
);

// Get a snapshot for a safe rollout rule by dimension
router.get(
  "/:id/snapshot/:dimension",
  validateRequestMiddleware({
    params: snapshotDimensionParams,
  }),
  safeRolloutSnapshotController.getSnapshotWithDimension
);

// Create a snapshot for a safe rollout rule
router.post(
  "/:id/snapshot",
  validateRequestMiddleware({
    body: createSafeRolloutSnapshotValidator,
    params: snapshotParams,
    query: z.object({ force: z.string().optional() }).optional(),
  }),
  safeRolloutSnapshotController.createSnapshot
);

// Cancel a running snapshot for a safe rollout rule
router.post(
  "/snapshot/:id/cancel",
  validateRequestMiddleware({
    params: snapshotParams,
  }),
  safeRolloutSnapshotController.cancelSnapshot
);

export { router as safeRolloutSnapshotRouter };
