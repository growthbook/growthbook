import { OpenApiRoute } from "back-end/src/util/handler";
import { listConfigs } from "./listConfigs";
import { postConfig } from "./postConfig";
import { getConfig } from "./getConfig";
import { updateConfig } from "./updateConfig";
import { archiveConfig, unarchiveConfig } from "./archiveConfig";
import { lockConfig } from "./postConfigLock";
import { unlockConfig } from "./postConfigUnlock";
import { deleteConfig } from "./deleteConfig";
import { getConfigReferences } from "./getConfigReferences";
import { getConfigKeyUsage } from "./getConfigKeyUsage";
import { getConfigLineage } from "./getConfigLineage";
import { getConfigSchema } from "./getConfigSchema";
import { verifyConfigSchema } from "./verifyConfigSchema";

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
import { postConfigRevisionReopen } from "./postConfigRevisionReopen";
import { postConfigRevisionRecallReview } from "./postConfigRevisionRecallReview";
import { postConfigRevisionSchedulePublish } from "./postConfigRevisionSchedulePublish";
import { putConfigRevisionMetadata } from "./putConfigRevisionMetadata";
import { putConfigRevisionValue } from "./putConfigRevisionValue";
import { putConfigRevisionSchema } from "./putConfigRevisionSchema";
import { putConfigRevisionProjection } from "./putConfigRevisionProjection";
import { deleteConfigRevisionProjection } from "./deleteConfigRevisionProjection";
import { putConfigRevisionArchive } from "./putConfigRevisionArchive";

export const configsRoutes: OpenApiRoute[] = [
  listConfigs,
  postConfig,
  listConfigRevisions,
  getConfigReferences,
  getConfigKeyUsage,
  getConfigLineage,
  verifyConfigSchema,
  getConfigSchema,
  getConfig,
  updateConfig,
  archiveConfig,
  unarchiveConfig,
  lockConfig,
  unlockConfig,
  deleteConfig,

  // `latest` MUST precede the `:version` route below; otherwise its int param
  // would swallow the literal "latest" and fail validation.
  getConfigRevisions,
  getConfigRevisionLatest,
  getConfigRevision,

  postConfigRevision,

  // Field-level edits accept `version: "new"` to auto-create a draft.
  putConfigRevisionMetadata,
  putConfigRevisionValue,
  putConfigRevisionSchema,
  putConfigRevisionProjection,
  deleteConfigRevisionProjection,
  putConfigRevisionArchive,

  postConfigRevisionRequestReview,
  postConfigRevisionSubmitReview,
  postConfigRevisionRecallReview,
  postConfigRevisionReopen,
  postConfigRevisionSchedulePublish,
  getConfigRevisionMergeStatus,
  postConfigRevisionRebase,
  postConfigRevisionPublish,
  postConfigRevisionDiscard,
  postConfigRevisionRevert,
];
