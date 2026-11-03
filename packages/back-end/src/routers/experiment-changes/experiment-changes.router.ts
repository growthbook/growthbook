import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import * as rawExperimentsController from "back-end/src/controllers/experiments";

const router = express.Router({ mergeParams: true });
const experimentsController = wrapController(rawExperimentsController);

router.post("/", experimentsController.postExperimentChanges);

export { router as experimentChangesRouter };
