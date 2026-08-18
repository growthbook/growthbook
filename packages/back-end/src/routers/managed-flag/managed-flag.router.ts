import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import * as rawExperimentsController from "back-end/src/controllers/experiments";
import * as rawFeaturesController from "back-end/src/controllers/features";
import { resolveManagedFlagParams } from "back-end/src/services/managedFeatures";

/**
 * Managed-flag actions addressed by experiment. `mergeParams` because the
 * experiment id lives on the parent path; the review and publish routes hand off
 * to the ordinary feature controllers so the lifecycle can't drift.
 */
const router = express.Router({ mergeParams: true });
const experimentsController = wrapController(rawExperimentsController);
const featuresController = wrapController(rawFeaturesController);

router.post("/", experimentsController.postExperimentManagedFlag);
router.post("/eject", experimentsController.postExperimentManagedFlagEject);

router.post(
  "/request-review",
  resolveManagedFlagParams,
  featuresController.postFeatureRequestReview,
);
router.post(
  "/submit-review",
  resolveManagedFlagParams,
  featuresController.postFeatureReviewOrComment,
);
router.post(
  "/recall-review",
  resolveManagedFlagParams,
  featuresController.postFeatureRecallReview,
);
router.post(
  "/undo-review",
  resolveManagedFlagParams,
  featuresController.postFeatureUndoReview,
);
router.post(
  "/publish",
  resolveManagedFlagParams,
  featuresController.postFeaturePublish,
);

export { router as managedFlagRouter };
