import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import * as rawImportingController from "./importing.controller.js";

const router = express.Router();
const importingController = wrapController(rawImportingController);

router.post("/statsig", importingController.proxyStatsigRequest);
router.post("/launchdarkly", importingController.proxyLaunchDarklyRequest);

export { router as importingRouter };
