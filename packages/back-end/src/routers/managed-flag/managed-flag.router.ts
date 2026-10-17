import express, { RequestHandler } from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import * as rawExperimentsController from "back-end/src/controllers/experiments";
import * as rawFeaturesController from "back-end/src/controllers/features";
import {
  resolveManagedFlagCommentParams,
  resolveManagedFlagParams,
} from "back-end/src/services/managedFeatures";

const router = express.Router({ mergeParams: true });
const experimentsController = wrapController(rawExperimentsController);
const featuresController = wrapController(rawFeaturesController);

// A managed draft publishes only through publishManagedDraft, so a review
// request may not arm an auto-publish or a schedule.
const stripPublishArming: RequestHandler = (req, res, next) => {
  if (req.body) {
    delete req.body.autoPublishOnApproval;
    delete req.body.scheduledPublishAt;
  }
  next();
};

router.get("/key-plan", experimentsController.getExperimentManagedFlagKeyPlan);
router.get(
  "/key-check",
  experimentsController.getExperimentManagedFlagKeyCheck,
);
router.post("/", experimentsController.postExperimentManagedFlag);
router.post("/eject", experimentsController.postExperimentManagedFlagEject);
router.post("/remove", experimentsController.postExperimentManagedFlagRemove);

// Review routes reuse the feature controllers so the lifecycle can't drift.
router.post(
  "/request-review",
  stripPublishArming,
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
// Merges server-side; postFeaturePublish needs a client-computed mergeResultSerialized.
router.post("/publish", experimentsController.postExperimentManagedFlagPublish);
// Comments stay editable; addressing their own revision lets an edit survive publishing.
router.put(
  "/log/:logId",
  resolveManagedFlagCommentParams,
  featuresController.putFeatureRevisionLogComment,
);

export { router as managedFlagRouter };
