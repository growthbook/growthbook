import { Router } from "express";
import { listVisualChangesets } from "back-end/src/api/visual-changesets/listVisualChangesets";
import { getExperimentResults } from "./getExperimentResults.js";
import { getExperiment } from "./getExperiment.js";
import { listExperiments } from "./listExperiments.js";
import { updateExperiment } from "./updateExperiment.js";
import { postExperiment } from "./postExperiment.js";
import { postExperimentSnapshot } from "./postExperimentSnapshot.js";

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
