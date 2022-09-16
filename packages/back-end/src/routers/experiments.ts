import express from "express";
import * as experimentsController from "../controllers/experiments";
import * as reportsController from "../controllers/reports";
import { wrapController } from "../services/routers";

wrapController(experimentsController);
wrapController(reportsController);

const router = express.Router();

router.get("/experiments", experimentsController.getExperiments);
router.post("/experiments", experimentsController.postExperiments);
router.get(
  "/experiments/frequency/month/:num",
  experimentsController.getExperimentsFrequencyMonth
);
router.get("/experiments/newfeatures/", experimentsController.getNewFeatures);
router.get("/experiments/snapshots/", experimentsController.getSnapshots);
router.get("/experiment/:id", experimentsController.getExperiment);
router.get("/experiment/:id/reports", reportsController.getReportsOnExperiment);
router.get("/snapshot/:id/status", experimentsController.getSnapshotStatus);
router.post("/snapshot/:id/cancel", experimentsController.cancelSnapshot);
router.get(
  "/experiment/:id/snapshot/:phase",
  experimentsController.getSnapshot
);
router.get(
  "/experiment/:id/snapshot/:phase/:dimension",
  experimentsController.getSnapshotWithDimension
);
router.post("/experiment/:id/snapshot", experimentsController.postSnapshot);
router.post(
  "/experiment/:id/snapshot/:phase/preview",
  experimentsController.previewManualSnapshot
);
router.post("/experiment/:id", experimentsController.postExperiment);
router.delete("/experiment/:id", experimentsController.deleteExperiment);
router.get("/experiment/:id/watchers", experimentsController.getWatchingUsers);
router.post("/experiment/:id/phase", experimentsController.postExperimentPhase);
router.post(
  "/experiment/:id/status",
  experimentsController.postExperimentStatus
);
router.put(
  "/experiment/:id/phase/:phase",
  experimentsController.putExperimentPhase
);
router.delete(
  "/experiment/:id/phase/:phase",
  experimentsController.deleteExperimentPhase
);
router.post("/experiment/:id/stop", experimentsController.postExperimentStop);
router.put(
  "/experiment/:id/variation/:variation/screenshot",
  experimentsController.addScreenshot
);
router.delete(
  "/experiment/:id/variation/:variation/screenshot",
  experimentsController.deleteScreenshot
);
router.post(
  "/experiment/:id/archive",
  experimentsController.postExperimentArchive
);
router.post(
  "/experiment/:id/unarchive",
  experimentsController.postExperimentUnarchive
);
router.post("/experiments/import", experimentsController.postPastExperiments);
router.get(
  "/experiments/import/:id",
  experimentsController.getPastExperimentsList
);
router.get(
  "/experiments/import/:id/status",
  experimentsController.getPastExperimentStatus
);
router.post(
  "/experiments/import/:id/cancel",
  experimentsController.cancelPastExperiments
);
router.post(
  "/experiments/notebook/:id",
  experimentsController.postSnapshotNotebook
);
router.post(
  "/experiments/report/:snapshot",
  reportsController.postReportFromSnapshot
);

export { router as experimentsRouter };
