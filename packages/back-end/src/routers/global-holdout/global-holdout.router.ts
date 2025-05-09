import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawGlobalHoldoutController from "./global-holdout.controller";

const router = express.Router();
const globalHoldoutController = wrapController(rawGlobalHoldoutController);

// List all global holdouts
router.get(
  "/",
  validateRequestMiddleware({}),
  globalHoldoutController.getGlobalHoldouts
);

export { router as globalHoldoutRouter };
