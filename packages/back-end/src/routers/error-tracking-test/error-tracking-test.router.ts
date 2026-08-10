import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as errorTrackingTestControllerRaw from "./error-tracking-test.controller";

const router = express.Router();

const errorTrackingTestController = wrapController(
  errorTrackingTestControllerRaw,
);

router.post(
  "/backend",
  validateRequestMiddleware({
    body: z
      .object({
        scenario: z.enum(["uncaught", "async-rejection", "logged", "handled"]),
      })
      .strict(),
  }),
  errorTrackingTestController.triggerBackendError,
);

export { router as errorTrackingTestRouter };
