import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import * as rawAutoRunController from "./auto-run.controller";

const router = express.Router();
const autoRunController = wrapController(rawAutoRunController);

router.get("/", autoRunController.getAutoRuns);
router.get("/:id", autoRunController.getAutoRun);

export { router as autoRunRouter };
