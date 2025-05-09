import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import * as rawGlobalHoldoutController from "./global-holdout.controller";

const router = express.Router();
const globalHoldoutController = wrapController(rawGlobalHoldoutController);

// List all global holdouts
router.get("/", globalHoldoutController.getGlobalHoldouts);

export { router as globalHoldoutRouter };
