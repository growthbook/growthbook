import { OpenApiRoute } from "back-end/src/util/handler";
import { listFeatures } from "./listFeatures";
import { toggleFeature } from "./toggleFeature";
import { revertFeature } from "./revertFeature";
import { getFeature } from "./getFeature";
import { postFeature } from "./postFeature";
import { updateFeature } from "./updateFeature";
import { deleteFeatureById } from "./deleteFeature";
import { getFeatureRevisions } from "./getFeatureRevisions";
import { getFeatureKeys } from "./getFeatureKeys";
import { getFeatureStale } from "./getFeatureStale";
import { getFeatureRevision } from "./getFeatureRevision";
import { getFeatureRevisionLatest } from "./getFeatureRevisionLatest";
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
import { putFeatureRevisionRuleRampSchedule } from "./putFeatureRevisionRuleRampSchedule";
import { deleteFeatureRevisionRuleRampSchedule } from "./deleteFeatureRevisionRuleRampSchedule";
import { postFeatureRevisionToggle } from "./postFeatureRevisionToggle";
import { putFeatureRevisionDefaultValue } from "./putFeatureRevisionDefaultValue";
import { putFeatureRevisionPrerequisites } from "./putFeatureRevisionPrerequisites";
import { putFeatureRevisionMetadata } from "./putFeatureRevisionMetadata";
import { putFeatureRevisionArchive } from "./putFeatureRevisionArchive";
import { putFeatureRevisionHoldout } from "./putFeatureRevisionHoldout";
import { postFeatureRevisionRevert } from "./postFeatureRevisionRevert";
import { listRevisions } from "./listRevisions";

export const featureRoutes: OpenApiRoute[] = [
  // Feature CRUD
  listFeatures,
  postFeature,
  getFeature,
  updateFeature,
  deleteFeatureById,
  toggleFeature,
  revertFeature,
  getFeatureKeys,
  getFeatureStale,

  // Reading & listing
  listRevisions,
  getFeatureRevisions,
  // Must precede getFeatureRevision: its :version param would otherwise
  // swallow the literal "latest" and fail int validation.
  getFeatureRevisionLatest,
  getFeatureRevision,

  // Draft creation
  postFeatureRevision,

  // Feature-level edits
  putFeatureRevisionMetadata,
  putFeatureRevisionDefaultValue,
  putFeatureRevisionPrerequisites,
  putFeatureRevisionHoldout,
  putFeatureRevisionArchive,
  postFeatureRevisionToggle,

  // Rules
  postFeatureRevisionRuleAdd,
  putFeatureRevisionRule,
  deleteFeatureRevisionRule,
  postFeatureRevisionRulesReorder,
  putFeatureRevisionRuleRampSchedule,
  deleteFeatureRevisionRuleRampSchedule,

  // Review & lifecycle
  postFeatureRevisionRequestReview,
  postFeatureRevisionSubmitReview,
  getFeatureRevisionMergeStatus,
  postFeatureRevisionRebase,
  postFeatureRevisionPublish,
  postFeatureRevisionDiscard,
  postFeatureRevisionRevert,
];
