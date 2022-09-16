import express from "express";
import * as featuresController from "../controllers/features";
import { wrapController } from "../services/routers";

wrapController(featuresController);

const router = express.Router();

router.get("/feature", featuresController.getFeatures);
router.get("/feature/:id", featuresController.getFeatureById);
router.post("/feature", featuresController.postFeatures);
router.put("/feature/:id", featuresController.putFeature);
router.delete("/feature/:id", featuresController.deleteFeatureById);
router.post(
  "/feature/:id/defaultvalue",
  featuresController.postFeatureDefaultValue
);
router.post("/feature/:id/discard", featuresController.postFeatureDiscard);
router.post("/feature/:id/publish", featuresController.postFeaturePublish);
router.post("/feature/:id/archive", featuresController.postFeatureArchive);
router.post("/feature/:id/toggle", featuresController.postFeatureToggle);
router.post("/feature/:id/draft", featuresController.postFeatureDraft);
router.post("/feature/:id/rule", featuresController.postFeatureRule);
router.put("/feature/:id/rule", featuresController.putFeatureRule);
router.delete("/feature/:id/rule", featuresController.deleteFeatureRule);
router.post("/feature/:id/reorder", featuresController.postFeatureMoveRule);
router.get("/usage/features", featuresController.getRealtimeUsage);

export { router as featuresRouter };
