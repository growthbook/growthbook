import { Router } from "express";
import { getExperimentResults } from "../../services/queries";
import { getExperiment } from "./getExperiment";
import { listExperiments } from "./listExperiments";

const router = Router();

// Experiment Endpoints
// Mounted at /api/v1/experiments
router.get("/", listExperiments);
router.get("/:id", getExperiment);
router.get("/:id/results", getExperimentResults);

export default router;
