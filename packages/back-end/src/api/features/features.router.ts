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

  // Cross-feature revision list
  listRevisions,

  // Revision list + create
  getFeatureRevisions,
  postFeatureRevision,

  // Latest active draft shortcut
  getFeatureRevisionLatest,

  // Single revision
  getFeatureRevision,

  // Lifecycle
  postFeatureRevisionDiscard,
  postFeatureRevisionPublish,
  postFeatureRevisionRevert,

  // Conflict resolution
  getFeatureRevisionMergeStatus,
  postFeatureRevisionRebase,

  // Review flow
  postFeatureRevisionRequestReview,
  postFeatureRevisionSubmitReview,

  // Rule edits
  postFeatureRevisionRuleAdd,
  postFeatureRevisionRulesReorder,
  putFeatureRevisionRule,
  deleteFeatureRevisionRule,

  // Rule ramp schedule
  putFeatureRevisionRuleRampSchedule,
  deleteFeatureRevisionRuleRampSchedule,

  // Field edits
  postFeatureRevisionToggle,
  putFeatureRevisionDefaultValue,
  putFeatureRevisionPrerequisites,
  putFeatureRevisionMetadata,
  putFeatureRevisionArchive,
  putFeatureRevisionHoldout,
];
