import express from "express";
import { z } from "zod";
import {
  createExperimentQaOverrideBodyValidator,
  reorderExperimentQaOverridesBodyValidator,
  updateExperimentQaOverrideBodyValidator,
} from "shared/validators";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawController from "./experiment-qa-overrides.controller";

const router = express.Router();

const controller = wrapController(rawController);

const idParams = z.object({ id: z.string() }).strict();

router.get(
  "/experiment/:id",
  validateRequestMiddleware({ params: idParams }),
  controller.getExperimentQaOverrides,
);
router.post(
  "/experiment/:id",
  validateRequestMiddleware({
    params: idParams,
    body: createExperimentQaOverrideBodyValidator,
  }),
  controller.postExperimentQaOverride,
);
router.put(
  "/experiment/:id/order",
  validateRequestMiddleware({
    params: idParams,
    body: reorderExperimentQaOverridesBodyValidator,
  }),
  controller.putExperimentQaOverridesOrder,
);
router.delete(
  "/experiment/:id",
  validateRequestMiddleware({ params: idParams }),
  controller.deleteExperimentQaOverrides,
);

router.get(
  "/sdk-connection/:id",
  validateRequestMiddleware({ params: idParams }),
  controller.getSdkConnectionQaOverrides,
);

router.put(
  "/:id",
  validateRequestMiddleware({
    params: idParams,
    body: updateExperimentQaOverrideBodyValidator,
  }),
  controller.putExperimentQaOverride,
);
router.delete(
  "/:id",
  validateRequestMiddleware({ params: idParams }),
  controller.deleteExperimentQaOverride,
);

export { router as experimentQaOverrideRouter };
