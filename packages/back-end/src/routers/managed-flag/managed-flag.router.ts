import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import * as rawExperimentsController from "back-end/src/controllers/experiments";
import * as rawFeaturesController from "back-end/src/controllers/features";
import {
  resolveManagedFlagCommentParams,
  resolveManagedFlagParams,
} from "back-end/src/services/managedFeatures";

/**
 * Managed-flag actions addressed by experiment. The review routes hand off to
 * the ordinary feature controllers so the lifecycle can't drift.
 */
const router = express.Router({ mergeParams: true });
const experimentsController = wrapController(rawExperimentsController);
const featuresController = wrapController(rawFeaturesController);

router.get("/key-plan", experimentsController.getExperimentManagedFlagKeyPlan);
router.post("/", experimentsController.postExperimentManagedFlag);
router.post("/eject", experimentsController.postExperimentManagedFlagEject);
router.post("/remove", experimentsController.postExperimentManagedFlagRemove);

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
router.post(
  "/recall-review",
  resolveManagedFlagParams,
  featuresController.postFeatureRecallReview,
);
// The Feature Flag page refuses every write on a managed flag, so a diverged or
// unwanted draft can only be rebased or discarded from here.
router.post(
  "/rebase",
  resolveManagedFlagParams,
  featuresController.postFeatureRebase,
);
router.post(
  "/discard",
  resolveManagedFlagParams,
  featuresController.postFeatureDiscard,
);
// Not postFeaturePublish: it wants a mergeResultSerialized this surface has no
// diff view to compute, so this merges server-side instead.
router.post("/publish", experimentsController.postExperimentManagedFlagPublish);
// Comments are conversation, not flag content, so they stay editable. Their own
// revision is addressed explicitly so an edit survives publishing.
router.put(
  "/log/:logId",
  resolveManagedFlagCommentParams,
  featuresController.putFeatureRevisionLogComment,
);

export { router as managedFlagRouter };
