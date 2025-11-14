import { Router } from "express";
import { getDashboard } from "./getDashboard";
import { listDashboards } from "./listDashboards";
import { postDashboard } from "./postDashboard";
import { updateDashboard } from "./updateDashboard";
import { deleteDashboard } from "./deleteDashboard";
import { getDashboardsForExperiment } from "./getDashboardsForExperiment";

const router = Router();

// Dashboard Endpoints
// Mounted at /api/v1/dashboards
router.get("/", listDashboards);
router.get("/by-experiment/:experimentId", getDashboardsForExperiment);
router.post("/", postDashboard);
router.get("/:id", getDashboard);
router.post("/:id", updateDashboard);
router.delete("/:id", deleteDashboard);

export default router;
