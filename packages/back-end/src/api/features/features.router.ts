import { Router } from "express";
import { listFeatures } from "./listFeatures";
import { toggleFeature } from "./toggleFeature";
import { revertFeature } from "./revertFeature";
import { getFeature } from "./getFeature";
import { postFeature } from "./postFeature";
import { updateFeature } from "./updateFeature";
import { deleteFeatureById } from "./deleteFeature";
import { getFeatureRevisions } from "./getFeatureRevisions";
import { getFeatureStale } from "./getFeatureStale";

const router = Router();

// Feature Endpoints
// Mounted at /api/v1/features
router.get("/", listFeatures);
router.post("/", postFeature);
router.get("/:id", getFeature);
router.post("/:id", updateFeature);
router.delete("/:id", deleteFeatureById);
router.post("/:id/toggle", toggleFeature);
router.post("/:id/revert", revertFeature);
router.get("/:id/revisions", getFeatureRevisions);
router.get("/:id/stale", getFeatureStale);

export default router;
