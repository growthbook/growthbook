import { OpenApiRoute } from "back-end/src/util/handler";
import { listConfigs } from "./listConfigs";
import { postConfig } from "./postConfig";
import { getConfig } from "./getConfig";
import { updateConfig } from "./updateConfig";
import { archiveConfig, unarchiveConfig } from "./archiveConfig";
import { deleteConfig } from "./deleteConfig";
import { getConfigReferences } from "./getConfigReferences";
import { getConfigLineage } from "./getConfigLineage";
import { getConfigSchema } from "./getConfigSchema";
import { verifyConfigSchema } from "./verifyConfigSchema";

// Revision routes
import { listConfigRevisions } from "./listConfigRevisions";
import { getConfigRevisions } from "./getConfigRevisions";
import { getConfigRevisionLatest } from "./getConfigRevisionLatest";
import { getConfigRevision } from "./getConfigRevision";
import { getConfigRevisionMergeStatus } from "./getConfigRevisionMergeStatus";
import { postConfigRevision } from "./postConfigRevision";
import { postConfigRevisionDiscard } from "./postConfigRevisionDiscard";
import { postConfigRevisionPublish } from "./postConfigRevisionPublish";
import { postConfigRevisionRebase } from "./postConfigRevisionRebase";
import { postConfigRevisionRevert } from "./postConfigRevisionRevert";
import { postConfigRevisionRequestReview } from "./postConfigRevisionRequestReview";
import { postConfigRevisionSubmitReview } from "./postConfigRevisionSubmitReview";
import { putConfigRevisionMetadata } from "./putConfigRevisionMetadata";
import { putConfigRevisionValue } from "./putConfigRevisionValue";
import { putConfigRevisionSchema } from "./putConfigRevisionSchema";
import { putConfigRevisionProjection } from "./putConfigRevisionProjection";
import { deleteConfigRevisionProjection } from "./deleteConfigRevisionProjection";
import { putConfigRevisionArchive } from "./putConfigRevisionArchive";

export const configsRoutes: OpenApiRoute[] = [
  // Config CRUD
  listConfigs,
  postConfig,
  listConfigRevisions,
  getConfigReferences,
  getConfigLineage,
  verifyConfigSchema,
  getConfigSchema,
  getConfig,
  updateConfig,
  archiveConfig,
  unarchiveConfig,
  deleteConfig,

  // Revisions — reading & listing.
  // `latest` MUST precede the `:version` route below; otherwise its int param
  // would swallow the literal "latest" and fail validation.
  getConfigRevisions,
  getConfigRevisionLatest,
  getConfigRevision,

  // Draft creation
  postConfigRevision,

  // Field-level edits — accept `version: "new"` to auto-create a draft.
  putConfigRevisionMetadata,
  putConfigRevisionValue,
  putConfigRevisionSchema,
  putConfigRevisionProjection,
  deleteConfigRevisionProjection,
  putConfigRevisionArchive,

  // Review & lifecycle
  postConfigRevisionRequestReview,
  postConfigRevisionSubmitReview,
  getConfigRevisionMergeStatus,
  postConfigRevisionRebase,
  postConfigRevisionPublish,
  postConfigRevisionDiscard,
  postConfigRevisionRevert,
];
