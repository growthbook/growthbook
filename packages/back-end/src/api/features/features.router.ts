import { Router } from "express";
import { listFeatures } from "./listFeatures";
import { toggleFeature } from "./toggleFeature";
import { getFeature } from "./getFeature";
import { getFeatures } from "./getFeatures";

const router = Router();

// Feature Endpoints
// Mounted at /api/v1/features

// Private features SDK payload endpoint (for proxies / edge workers):
router.get("/:key?", getFeatures);
// For preflight requests
router.options("/:key?", (req, res) => res.send(200));

// Everything else
router.get("/", listFeatures);
router.get("/:id", getFeature);
router.post("/:id/toggle", toggleFeature);

export default router;
