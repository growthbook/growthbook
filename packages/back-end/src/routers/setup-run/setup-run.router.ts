import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import * as rawSetupRunController from "./setup-run.controller";

const router = express.Router();
const setupRunController = wrapController(rawSetupRunController);

router.get("/", setupRunController.getSetupRuns);
router.get("/:id", setupRunController.getSetupRun);

export { router as setupRunRouter };
