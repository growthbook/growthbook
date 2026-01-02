import { Router } from "express";
import { listVisualChangesets } from "back-end/src/api/visual-changesets/listVisualChangesets";
import { getExperimentResults } from "./getExperimentResults";
import { getExperiment } from "./getExperiment";
import { listExperiments } from "./listExperiments";
import { updateExperiment } from "./updateExperiment";
import { postExperiment } from "./postExperiment";
import { postExperimentSnapshot } from "./postExperimentSnapshot";

const router = Router();

// Experiment Endpoints
// Mounted at /api/v1/experiments
router.get("/", listExperiments);
router.post("/", postExperiment);
router.get("/:id", getExperiment);
router.get("/:id/results", getExperimentResults);
router.post("/:id", updateExperiment);
router.post("/:id/snapshot", postExperimentSnapshot);

// VisualChangeset Endpoints
router.get("/:id/visual-changesets", listVisualChangesets);

export default router;
