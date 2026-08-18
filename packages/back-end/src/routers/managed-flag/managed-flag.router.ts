import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import * as rawExperimentsController from "back-end/src/controllers/experiments";
import * as rawFeaturesController from "back-end/src/controllers/features";
import { resolveManagedFlagParams } from "back-end/src/services/managedFeatures";

/**
 * Everything an experiment-managed Feature Flag can have done to it, addressed
 * by experiment. Mounted under `/experiment/:id/managed-flag`, which is why it
 * needs `mergeParams` — the experiment id lives on the parent path.
 *
 * The review and publish routes deliberately hand off to the ordinary feature
 * controllers. `resolveManagedFlagParams` rewrites `:id` (experiment) into the
 * `(feature id, draft version)` those controllers already take, so managed mode
 * runs the same review lifecycle as any other flag rather than a parallel
 * implementation that could drift from it.
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
