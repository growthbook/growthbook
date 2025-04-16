import { Router } from "express";
import { getSafeRolloutSnapshot } from "./getSafeRolloutSnapshot";
import { postSafeRolloutSnapshot } from "./postSafeRolloutSnapshot";

const router = Router();

// Mounted at /api/v1/safe-rollouts/snapshot/:id
router.get("/snapshot/:id", getSafeRolloutSnapshot);

// Mounted at /api/v1/safe-rollouts/:id/snapshot
router.post("/:id/snapshot", postSafeRolloutSnapshot);

export default router;
