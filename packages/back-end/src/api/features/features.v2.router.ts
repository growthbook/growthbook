import { OpenApiRoute } from "back-end/src/util/handler";
import { listFeaturesV2 } from "./listFeatures";
import { getFeatureV2 } from "./getFeature";
import { postFeatureV2 } from "./postFeatureV2";
import { updateFeatureV2 } from "./updateFeatureV2";
import { deleteFeatureByIdV2 } from "./deleteFeature";
import { toggleFeatureV2 } from "./toggleFeature";
import { revertFeatureV2 } from "./revertFeature";
import { getFeatureKeysV2 } from "./getFeatureKeys";
import { getFeatureStaleV2 } from "./getFeatureStale";
import { getFeatureRevisionsV2 } from "./getFeatureRevisions";
import { getFeatureRevisionV2 } from "./getFeatureRevision";
import { getFeatureRevisionLatestV2 } from "./getFeatureRevisionLatest";
import { postFeatureRevisionV2 } from "./postFeatureRevision";
import { postFeatureRevisionDiscardV2 } from "./postFeatureRevisionDiscard";
import { postFeatureRevisionPublishV2 } from "./postFeatureRevisionPublish";
import { postFeatureRevisionRevertV2 } from "./postFeatureRevisionRevert";
import { getFeatureRevisionMergeStatusV2 } from "./getFeatureRevisionMergeStatus";
import { postFeatureRevisionRebaseV2 } from "./postFeatureRevisionRebase";
import { postFeatureRevisionRequestReviewV2 } from "./postFeatureRevisionRequestReview";
import { postFeatureRevisionSubmitReviewV2 } from "./postFeatureRevisionSubmitReview";
import { postFeatureRevisionRuleAddV2 } from "./postFeatureRevisionRuleAdd";
import { postFeatureRevisionRulesReorderV2 } from "./postFeatureRevisionRulesReorder";
import { putFeatureRevisionRuleV2 } from "./putFeatureRevisionRule";
import { deleteFeatureRevisionRuleV2 } from "./deleteFeatureRevisionRule";
import { putFeatureRevisionRuleRampScheduleV2 } from "./putFeatureRevisionRuleRampSchedule";
import { deleteFeatureRevisionRuleRampScheduleV2 } from "./deleteFeatureRevisionRuleRampSchedule";
import { postFeatureRevisionToggleV2 } from "./postFeatureRevisionToggle";
import { putFeatureRevisionDefaultValueV2 } from "./putFeatureRevisionDefaultValue";
import { putFeatureRevisionPrerequisitesV2 } from "./putFeatureRevisionPrerequisites";
import { putFeatureRevisionMetadataV2 } from "./putFeatureRevisionMetadata";
import { putFeatureRevisionArchiveV2 } from "./putFeatureRevisionArchive";
import { putFeatureRevisionHoldoutV2 } from "./putFeatureRevisionHoldout";
import { listRevisionsV2 } from "./listRevisions";

export const featureV2Routes: OpenApiRoute[] = [
  // Feature CRUD
  listFeaturesV2,
  postFeatureV2,
  getFeatureV2,
  updateFeatureV2,
  deleteFeatureByIdV2,
  toggleFeatureV2,
  revertFeatureV2,
  getFeatureKeysV2,
  getFeatureStaleV2,

  // Reading & listing revisions
  listRevisionsV2,
  getFeatureRevisionsV2,
  // Must precede getFeatureRevisionV2: "latest" literal would otherwise be
  // swallowed by the :version param and fail int validation.
  getFeatureRevisionLatestV2,
  getFeatureRevisionV2,

  // Draft creation
  postFeatureRevisionV2,

  // Feature-level edits
  putFeatureRevisionMetadataV2,
  putFeatureRevisionDefaultValueV2,
  putFeatureRevisionPrerequisitesV2,
  putFeatureRevisionHoldoutV2,
  putFeatureRevisionArchiveV2,
  postFeatureRevisionToggleV2,

  // Rules
  postFeatureRevisionRuleAddV2,
  putFeatureRevisionRuleV2,
  deleteFeatureRevisionRuleV2,
  postFeatureRevisionRulesReorderV2,
  putFeatureRevisionRuleRampScheduleV2,
  deleteFeatureRevisionRuleRampScheduleV2,

  // Review & lifecycle
  postFeatureRevisionRequestReviewV2,
  postFeatureRevisionSubmitReviewV2,
  getFeatureRevisionMergeStatusV2,
  postFeatureRevisionRebaseV2,
  postFeatureRevisionPublishV2,
  postFeatureRevisionDiscardV2,
  postFeatureRevisionRevertV2,
];
