import { OpenApiRoute } from "back-end/src/util/handler";
import { listConstants } from "./listConstants";
import { postConstant } from "./postConstant";
import { getConstant } from "./getConstant";
import { updateConstant } from "./updateConstant";
import { archiveConstant, unarchiveConstant } from "./archiveConstant";
import { deleteConstant } from "./deleteConstant";
import { getConstantReferences } from "./getConstantReferences";

// Revision routes
import { listConstantRevisions } from "./listConstantRevisions";
import { getConstantRevisions } from "./getConstantRevisions";
import { getConstantRevisionLatest } from "./getConstantRevisionLatest";
import { getConstantRevision } from "./getConstantRevision";
import { getConstantRevisionMergeStatus } from "./getConstantRevisionMergeStatus";
import { postConstantRevision } from "./postConstantRevision";
import { postConstantRevisionDiscard } from "./postConstantRevisionDiscard";
import { postConstantRevisionPublish } from "./postConstantRevisionPublish";
import { postConstantRevisionRebase } from "./postConstantRevisionRebase";
import { postConstantRevisionRevert } from "./postConstantRevisionRevert";
import { postConstantRevisionRequestReview } from "./postConstantRevisionRequestReview";
import { postConstantRevisionSubmitReview } from "./postConstantRevisionSubmitReview";
import { putConstantRevisionMetadata } from "./putConstantRevisionMetadata";
import { putConstantRevisionValue } from "./putConstantRevisionValue";
import { putConstantRevisionArchive } from "./putConstantRevisionArchive";

export const constantsRoutes: OpenApiRoute[] = [
  // Constant CRUD
  listConstants,
  postConstant,
  listConstantRevisions,
  getConstantReferences,
  getConstant,
  updateConstant,
  archiveConstant,
  unarchiveConstant,
  deleteConstant,

  // Revisions — reading & listing.
  // `latest` MUST precede the `:version` route below; otherwise its int param
  // would swallow the literal "latest" and fail validation.
  getConstantRevisions,
  getConstantRevisionLatest,
  getConstantRevision,

  // Draft creation
  postConstantRevision,

  // Field-level edits — accept `version: "new"` to auto-create a draft.
  putConstantRevisionMetadata,
  putConstantRevisionValue,
  putConstantRevisionArchive,

  // Review & lifecycle
  postConstantRevisionRequestReview,
  postConstantRevisionSubmitReview,
  getConstantRevisionMergeStatus,
  postConstantRevisionRebase,
  postConstantRevisionPublish,
  postConstantRevisionDiscard,
  postConstantRevisionRevert,
];
