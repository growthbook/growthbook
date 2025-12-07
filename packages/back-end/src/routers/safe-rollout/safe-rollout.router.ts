import express from "express";
import { z } from "zod";
import {
  safeRolloutStatusArray,
  createSafeRolloutValidator,
} from "shared/src/validators/safe-rollout";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawSnapshotController from "./safe-rollout.controller";

const router = express.Router();
const safeRolloutController = wrapController(rawSnapshotController);

const snapshotParams = z.object({ id: z.string() }).strict();
const statusBody = z
  .object({ status: z.enum(safeRolloutStatusArray) })
  .strict();
const safeRolloutBody = z
  .object({
    safeRolloutFields: createSafeRolloutValidator.partial(),
    environment: z.string(),
  })
  .strict();
const safeRolloutParams = z.object({ id: z.string() }).strict();
// Update the status of a safe rollout rule (rolled back, released, etc)
router.put(
  "/:id/status",
  validateRequestMiddleware({ body: statusBody }),
  safeRolloutController.putSafeRolloutStatus,
);

// Get the latest snapshot for a safe rollout rule
router.get(
  "/:id/snapshot",
  validateRequestMiddleware({
    params: snapshotParams,
  }),
  safeRolloutController.getLatestSafeRolloutSnapshot,
);

// Create a snapshot for a safe rollout rule
router.post(
  "/:id/snapshot",
  validateRequestMiddleware({
    params: snapshotParams,
    query: z.object({ force: z.string().optional() }).optional(),
  }),
  safeRolloutController.postSafeRolloutSnapshot,
);

// Cancel a running snapshot for a safe rollout rule
router.post(
  "/snapshot/:id/cancel",
  validateRequestMiddleware({
    params: snapshotParams,
  }),
  safeRolloutController.cancelSafeRolloutSnapshot,
);
router.put(
  "/:id",
  validateRequestMiddleware({
    params: safeRolloutParams,
    body: safeRolloutBody,
  }),
  safeRolloutController.putSafeRollout,
);

// Get the latest snapshot for a safe rollout rule
router.get(
  "/:id/time-series",
  validateRequestMiddleware({
    params: snapshotParams,
  }),
  safeRolloutController.getSafeRolloutTimeSeries,
);
router.get("/", safeRolloutController.getSafeRollouts);

export { router as safeRolloutRouter };
