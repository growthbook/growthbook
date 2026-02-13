import { Router } from "express";
import { getExperimentSnapshot } from "./getExperimentSnapshot.js";

const router = Router();

// Snapshots Endpoints
// Mounted at /api/v1/snapshots
router.get("/:id", getExperimentSnapshot);

export default router;
