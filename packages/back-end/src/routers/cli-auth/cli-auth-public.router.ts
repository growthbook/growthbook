import express from "express";
import { cliAuthInitBody, cliAuthExchangeBody } from "shared/validators";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawCliAuthController from "./cli-auth.controller";

const router = express.Router();
const cliAuthController = wrapController(rawCliAuthController);

// Public endpoints — mounted BEFORE processJWT.
// No auth: an agent kicks off the flow with no GB account context.

router.post(
  "/init",
  validateRequestMiddleware({ body: cliAuthInitBody }),
  cliAuthController.postInit,
);

router.post(
  "/exchange",
  validateRequestMiddleware({ body: cliAuthExchangeBody }),
  cliAuthController.postExchange,
);

export { router as cliAuthPublicRouter };
