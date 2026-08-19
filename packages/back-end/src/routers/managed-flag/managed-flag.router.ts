import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import * as rawExperimentsController from "back-end/src/controllers/experiments";
import * as rawFeaturesController from "back-end/src/controllers/features";
import {
  resolveManagedFlagCommentParams,
  resolveManagedFlagParams,
} from "back-end/src/services/managedFeatures";

/**
 * Managed-flag actions addressed by experiment. `mergeParams` because the
 * experiment id lives on the parent path; the review and publish routes hand off
 * to the ordinary feature controllers so the lifecycle can't drift.
 */
const router = express.Router({ mergeParams: true });
const experimentsController = wrapController(rawExperimentsController);
const featuresController = wrapController(rawFeaturesController);

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
  "/undo-review",
  resolveManagedFlagParams,
  featuresController.postFeatureUndoReview,
);
// Not resolveManagedFlagParams + postFeaturePublish: that controller requires a
// mergeResultSerialized this surface can't compute, so it merges server-side.
router.post("/publish", experimentsController.postExperimentManagedFlagPublish);
// Review comments are conversation, not flag content, so they stay editable —
// but only through the experiment, like everything else on a managed flag. The
// comment's own revision is addressed explicitly so it survives publishing.
router.put(
  "/log/:logId",
  resolveManagedFlagCommentParams,
  featuresController.putFeatureRevisionLogComment,
);

export { router as managedFlagRouter };
