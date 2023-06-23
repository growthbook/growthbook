import { Router } from "express";
import { listVisualChangesets } from "../visual-changesets/listVisualChangesets";
import { getExperimentResults } from "./getExperimentResults";
import { getExperiment } from "./getExperiment";
import { listExperiments } from "./listExperiments";
import { putExperiment } from "./putExperiment";
import { postExperiment } from "./postExperiment";

const router = Router();

// Experiment Endpoints
// Mounted at /api/v1/experiments
router.get("/", listExperiments);
router.post("/", postExperiment);
router.get("/:id", getExperiment);
router.get("/:id/results", getExperimentResults);
router.put("/:id", putExperiment);

// VisualChangeset Endpoints
router.get("/:id/visual-changesets", listVisualChangesets);

export default router;
