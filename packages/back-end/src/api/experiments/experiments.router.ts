import { Router } from "express";
import { listVisualChangesets } from "../visual-changesets/listVisualChangesets";
import { getExperimentResults } from "./getExperimentResults";
import { getExperiment } from "./getExperiment";
import { listExperiments } from "./listExperiments";

const router = Router();

// Experiment Endpoints
// Mounted at /api/v1/experiments
router.get("/", listExperiments);
router.get("/:id", getExperiment);
router.get("/:id/results", getExperimentResults);

// VisualChangeset Endpoints
router.get("/:id/visual-changesets", listVisualChangesets);

export default router;
