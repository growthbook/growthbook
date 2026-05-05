import { OpenApiRoute } from "back-end/src/util/handler";
import { listFeaturesV2 } from "./listFeaturesV2";
import { getFeatureV2 } from "./getFeatureV2";
import { postFeatureV2 } from "./postFeatureV2";
import { updateFeatureV2 } from "./updateFeatureV2";
import { deleteFeatureByIdV2 } from "./deleteFeatureV2";
import { toggleFeatureV2 } from "./toggleFeatureV2";
import { revertFeatureV2 } from "./revertFeatureV2";
import { getFeatureKeysV2 } from "./getFeatureKeysV2";
import { getFeatureStaleV2 } from "./getFeatureStaleV2";
import { getFeatureRevisionsV2 } from "./getFeatureRevisionsV2";
import { getFeatureRevisionV2 } from "./getFeatureRevisionV2";
import { getFeatureRevisionLatestV2 } from "./getFeatureRevisionLatestV2";
import { postFeatureRevisionV2 } from "./postFeatureRevisionV2";
import { postFeatureRevisionDiscardV2 } from "./postFeatureRevisionDiscardV2";
import { postFeatureRevisionPublishV2 } from "./postFeatureRevisionPublishV2";
import { postFeatureRevisionRevertV2 } from "./postFeatureRevisionRevertV2";
import { getFeatureRevisionMergeStatusV2 } from "./getFeatureRevisionMergeStatusV2";
import { postFeatureRevisionRebaseV2 } from "./postFeatureRevisionRebaseV2";
import { postFeatureRevisionRequestReviewV2 } from "./postFeatureRevisionRequestReviewV2";
import { postFeatureRevisionSubmitReviewV2 } from "./postFeatureRevisionSubmitReviewV2";
import { postFeatureRevisionRuleAddV2 } from "./postFeatureRevisionRuleAddV2";
import { postFeatureRevisionRulesReorderV2 } from "./postFeatureRevisionRulesReorderV2";
import { putFeatureRevisionRuleV2 } from "./putFeatureRevisionRuleV2";
import { deleteFeatureRevisionRuleV2 } from "./deleteFeatureRevisionRuleV2";
import { putFeatureRevisionRuleRampScheduleV2 } from "./putFeatureRevisionRuleRampScheduleV2";
import { deleteFeatureRevisionRuleRampScheduleV2 } from "./deleteFeatureRevisionRuleRampScheduleV2";
import { postFeatureRevisionToggleV2 } from "./postFeatureRevisionToggleV2";
import { putFeatureRevisionDefaultValueV2 } from "./putFeatureRevisionDefaultValueV2";
import { putFeatureRevisionPrerequisitesV2 } from "./putFeatureRevisionPrerequisitesV2";
import { putFeatureRevisionMetadataV2 } from "./putFeatureRevisionMetadataV2";
import { putFeatureRevisionArchiveV2 } from "./putFeatureRevisionArchiveV2";
import { putFeatureRevisionHoldoutV2 } from "./putFeatureRevisionHoldoutV2";
import { listRevisionsV2 } from "./listRevisionsV2";

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
