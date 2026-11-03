import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import * as rawAutoRunController from "./auto-run.controller";

const router = express.Router();
const autoRunController = wrapController(rawAutoRunController);

router.get("/", autoRunController.getAutoRuns);
router.get("/:id", autoRunController.getAutoRun);
router.post("/", autoRunController.postAutoRun);
router.post("/:id/artifacts", autoRunController.postAutoRunArtifacts);
router.put("/:id", autoRunController.putAutoRun);

export { router as autoRunRouter };
