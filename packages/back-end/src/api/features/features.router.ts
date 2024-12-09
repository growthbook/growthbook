import { Router } from "express";
import { listFeatures } from "./listFeatures";
import { toggleFeature } from "./toggleFeature";
import { getFeature } from "./getFeature";
import { postFeature } from "./postFeature";
import { updateFeature } from "./updateFeature";
import { deleteFeatureById } from "./deleteFeature";

const router = Router();

// Feature Endpoints
// Mounted at /api/v1/features
router.get("/", listFeatures);
router.post("/", postFeature);
router.get("/:id", getFeature);
router.post("/:id", updateFeature);
router.delete("/:id", deleteFeatureById);
router.post("/:id/toggle", toggleFeature);

export default router;
