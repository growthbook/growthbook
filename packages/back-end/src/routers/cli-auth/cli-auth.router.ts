import express from "express";
import { z } from "zod";
import { cliAuthApproveBody } from "shared/validators";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawCliAuthController from "./cli-auth.controller";

const router = express.Router();
const cliAuthController = wrapController(rawCliAuthController);

// Authenticated endpoints — mounted AFTER processJWT.

router.get(
  "/request/:id",
  validateRequestMiddleware({
    params: z.object({ id: z.string() }).strict(),
  }),
  cliAuthController.getRequest,
);

router.post(
  "/approve",
  validateRequestMiddleware({ body: cliAuthApproveBody }),
  cliAuthController.postApprove,
);

export { router as cliAuthRouter };
