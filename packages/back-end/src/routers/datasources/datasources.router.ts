import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import * as rawDatasourcesController from "back-end/src/controllers/datasources";

const router = express.Router();

const datasourcesController = wrapController(rawDatasourcesController);

router.post(
  "/datasources/event-forwarder/detect-region",
  datasourcesController.postDetectEventForwarderRegion,
);

export { router as datasourcesRouter };
