import { Router } from "express";
import { listFeatures } from "./listFeatures.js";
import { toggleFeature } from "./toggleFeature.js";
import { revertFeature } from "./revertFeature.js";
import { getFeature } from "./getFeature.js";
import { postFeature } from "./postFeature.js";
import { updateFeature } from "./updateFeature.js";
import { deleteFeatureById } from "./deleteFeature.js";
import { getFeatureRevisions } from "./getFeatureRevisions.js";

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

export default router;
