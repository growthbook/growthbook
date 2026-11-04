import express from "express";
import { z } from "zod";
import {
  createExperimentQaOverridesBodyValidator,
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
    body: createExperimentQaOverridesBodyValidator,
  }),
  controller.postExperimentQaOverrides,
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
router.delete(
  "/sdk-connection/:id",
  validateRequestMiddleware({ params: idParams }),
  controller.deleteSdkConnectionQaOverrides,
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
