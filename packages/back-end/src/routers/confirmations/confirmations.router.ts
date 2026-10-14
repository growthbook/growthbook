import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawConfirmationsController from "./confirmations.controller";

const router = express.Router();

const ConfirmationsController = wrapController(rawConfirmationsController);

const idParams = z.strictObject({ id: z.string() });
const decisionBody = z.strictObject({ note: z.string().optional() });

router.get("/labels", ConfirmationsController.getConfirmationLabels);

router.get(
  "/:id",
  validateRequestMiddleware({ params: idParams }),
  ConfirmationsController.getConfirmation,
);

router.post(
  "/:id/confirm",
  validateRequestMiddleware({ params: idParams, body: decisionBody }),
  ConfirmationsController.postConfirm,
);

router.post(
  "/:id/reject",
  validateRequestMiddleware({ params: idParams, body: decisionBody }),
  ConfirmationsController.postReject,
);

export { router as confirmationsRouter };
