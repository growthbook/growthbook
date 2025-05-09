import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import { globalHoldoutStatusArray } from "back-end/src/validators/global-holdout";
import * as rawGlobalHoldoutController from "./global-holdout.controller";

const router = express.Router();
const globalHoldoutController = wrapController(rawGlobalHoldoutController);

const globalHoldoutParams = z.object({ id: z.string() }).strict();
const statusBody = z
  .object({ status: z.enum(globalHoldoutStatusArray) })
  .strict();
const createGlobalHoldoutBody = z
  .object({
    key: z.string(),
    description: z.string().optional(),
    linkedFeatures: z.array(z.string()).optional(),
    linkedExperiments: z.array(z.string()).optional(),
  })
  .strict();

// Create a new global holdout
router.post(
  "/",
  validateRequestMiddleware({ body: createGlobalHoldoutBody }),
  globalHoldoutController.postGlobalHoldout
);

// Update the status of a global holdout
router.put(
  "/:id/status",
  validateRequestMiddleware({ body: statusBody, params: globalHoldoutParams }),
  globalHoldoutController.putGlobalHoldoutStatus
);

export { router as globalHoldoutRouter };
