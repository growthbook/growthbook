import { Router } from "express";
import { listFeatures } from "./listFeatures";
import { toggleFeature } from "./toggleFeature";
import { revertFeature } from "./revertFeature";
import { getFeature } from "./getFeature";
import { postFeature } from "./postFeature";
import { updateFeature } from "./updateFeature";
import { deleteFeatureById } from "./deleteFeature";
import { getFeatureRevisions } from "./getFeatureRevisions";
import { getFeatureRevision } from "./getFeatureRevision";
import { postFeatureRevision } from "./postFeatureRevision";
import { postFeatureRevisionDiscard } from "./postFeatureRevisionDiscard";
import { postFeatureRevisionPublish } from "./postFeatureRevisionPublish";
import { getFeatureRevisionMergeStatus } from "./getFeatureRevisionMergeStatus";
import { postFeatureRevisionRebase } from "./postFeatureRevisionRebase";
import { postFeatureRevisionRequestReview } from "./postFeatureRevisionRequestReview";
import { postFeatureRevisionSubmitReview } from "./postFeatureRevisionSubmitReview";
import { postFeatureRevisionRuleAdd } from "./postFeatureRevisionRuleAdd";
import { postFeatureRevisionRulesReorder } from "./postFeatureRevisionRulesReorder";
import { putFeatureRevisionRule } from "./putFeatureRevisionRule";
import { deleteFeatureRevisionRule } from "./deleteFeatureRevisionRule";
import { putFeatureRevisionRampActions } from "./putFeatureRevisionRampActions";
import { postFeatureRevisionToggle } from "./postFeatureRevisionToggle";
import { putFeatureRevisionDefaultValue } from "./putFeatureRevisionDefaultValue";
import { putFeatureRevisionPrerequisites } from "./putFeatureRevisionPrerequisites";
import { putFeatureRevisionMetadata } from "./putFeatureRevisionMetadata";
import { putFeatureRevisionArchive } from "./putFeatureRevisionArchive";
import { putFeatureRevisionHoldout } from "./putFeatureRevisionHoldout";
import { postFeatureRevisionRevert } from "./postFeatureRevisionRevert";

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

// Revision list + create
router.get("/:id/revisions", getFeatureRevisions);
router.post("/:id/revisions", postFeatureRevision);

// Single revision
router.get("/:id/revisions/:version", getFeatureRevision);

// Lifecycle
router.post("/:id/revisions/:version/discard", postFeatureRevisionDiscard);
router.post("/:id/revisions/:version/publish", postFeatureRevisionPublish);
router.post("/:id/revisions/:version/revert", postFeatureRevisionRevert);

// Conflict resolution
router.get(
  "/:id/revisions/:version/merge-status",
  getFeatureRevisionMergeStatus,
);
router.post("/:id/revisions/:version/rebase", postFeatureRevisionRebase);

// Review flow
router.post(
  "/:id/revisions/:version/request-review",
  postFeatureRevisionRequestReview,
);
router.post(
  "/:id/revisions/:version/submit-review",
  postFeatureRevisionSubmitReview,
);

// Rule edits — register static paths before :ruleId param to avoid shadowing
router.post("/:id/revisions/:version/rules", postFeatureRevisionRuleAdd);
router.post(
  "/:id/revisions/:version/rules/reorder",
  postFeatureRevisionRulesReorder,
);
router.put("/:id/revisions/:version/rules/:ruleId", putFeatureRevisionRule);
router.delete(
  "/:id/revisions/:version/rules/:ruleId",
  deleteFeatureRevisionRule,
);

// Ramp actions
router.put(
  "/:id/revisions/:version/ramp-actions",
  putFeatureRevisionRampActions,
);

// Field edits
router.post("/:id/revisions/:version/toggle", postFeatureRevisionToggle);
router.put(
  "/:id/revisions/:version/default-value",
  putFeatureRevisionDefaultValue,
);
router.put(
  "/:id/revisions/:version/prerequisites",
  putFeatureRevisionPrerequisites,
);
router.put("/:id/revisions/:version/metadata", putFeatureRevisionMetadata);
router.put("/:id/revisions/:version/archive", putFeatureRevisionArchive);
router.put("/:id/revisions/:version/holdout", putFeatureRevisionHoldout);

export default router;
