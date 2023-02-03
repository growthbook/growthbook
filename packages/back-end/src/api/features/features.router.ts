import { Router } from "express";
import { getFeatureRevisions } from "./getFeatureRevisions";
import { listFeatures } from "./listFeatures";
import { toggleFeature } from "./toggleFeature";

const router = Router();

// Feature Endpoints
// Mounted at /api/v1/features
router.get("/", listFeatures);
router.post("/:key/toggle", toggleFeature);
router.get("/:key/revisions", getFeatureRevisions);

export default router;
