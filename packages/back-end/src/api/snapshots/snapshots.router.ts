import { Router } from "express";
import { getExperimentSnapshot } from "./getExperimentSnapshot";

const router = Router();

// Snapshots Endpoints
// Mounted at /api/v1/snapshots
router.get("/:id", getExperimentSnapshot);

export default router;
