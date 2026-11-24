import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import * as rawController from "./admin-auto-experiments.controller";

// Super admin backfill of the auto experiment opt-ins across organizations
const router = express.Router();
const controller = wrapController(rawController);

router.get("/admin/auto-experiments/backfill", controller.getBackfill);
router.post("/admin/auto-experiments/backfill", controller.postBackfill);

export { router as adminAutoExperimentsRouter };
