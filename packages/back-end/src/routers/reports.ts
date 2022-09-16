import express from "express";
import * as reportsController from "../controllers/reports";
import { wrapController } from "../services/routers";

wrapController(reportsController);

const router = express.Router();

router.get("/report/:id", reportsController.getReport);
router.put("/report/:id", reportsController.putReport);
router.delete("/report/:id", reportsController.deleteReport);
router.get("/report/:id/status", reportsController.getReportStatus);
router.post("/report/:id/refresh", reportsController.refreshReport);
router.post("/report/:id/cancel", reportsController.cancelReport);
router.post("/report/:id/notebook", reportsController.postNotebook);
router.get("/reports", reportsController.getReports);

export { router as reportsRouter };
