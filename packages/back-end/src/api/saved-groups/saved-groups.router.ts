import { OpenApiRoute } from "back-end/src/util/handler";
import { getSavedGroup } from "./getSavedGroup";
import { listSavedGroups } from "./listSavedGroups";
import { postSavedGroup } from "./postSavedGroup";
import { updateSavedGroup } from "./updateSavedGroup";
import { archiveSavedGroup, unarchiveSavedGroup } from "./archiveSavedGroup";
import { deleteSavedGroup } from "./deleteSavedGroup";

// Revision routes
import { listSavedGroupRevisions } from "./listSavedGroupRevisions";
import { getSavedGroupRevisions } from "./getSavedGroupRevisions";
import { getSavedGroupRevisionLatest } from "./getSavedGroupRevisionLatest";
import { getSavedGroupRevision } from "./getSavedGroupRevision";
import { getSavedGroupRevisionMergeStatus } from "./getSavedGroupRevisionMergeStatus";
import { postSavedGroupRevision } from "./postSavedGroupRevision";
import { postSavedGroupRevisionDiscard } from "./postSavedGroupRevisionDiscard";
import { postSavedGroupRevisionPublish } from "./postSavedGroupRevisionPublish";
import { postSavedGroupRevisionRebase } from "./postSavedGroupRevisionRebase";
import { postSavedGroupRevisionRevert } from "./postSavedGroupRevisionRevert";
import { postSavedGroupRevisionRequestReview } from "./postSavedGroupRevisionRequestReview";
import { postSavedGroupRevisionSubmitReview } from "./postSavedGroupRevisionSubmitReview";
import { putSavedGroupRevisionMetadata } from "./putSavedGroupRevisionMetadata";
import { putSavedGroupRevisionCondition } from "./putSavedGroupRevisionCondition";
import { putSavedGroupRevisionValues } from "./putSavedGroupRevisionValues";
import { putSavedGroupRevisionArchive } from "./putSavedGroupRevisionArchive";
import { postSavedGroupRevisionItemsAdd } from "./postSavedGroupRevisionItemsAdd";
import { postSavedGroupRevisionItemsRemove } from "./postSavedGroupRevisionItemsRemove";

export const savedGroupsRoutes: OpenApiRoute[] = [
  // Saved-group CRUD
  listSavedGroups,
  postSavedGroup,
  listSavedGroupRevisions,
  getSavedGroup,
  updateSavedGroup,
  archiveSavedGroup,
  unarchiveSavedGroup,
  deleteSavedGroup,

  // Revisions — reading & listing.
  // `latest` MUST precede the `:version` route below; otherwise its int param
  // would swallow the literal "latest" and fail validation.
  getSavedGroupRevisions,
  getSavedGroupRevisionLatest,
  getSavedGroupRevision,

  // Draft creation
  postSavedGroupRevision,

  // Field-level edits — accept `version: "new"` to auto-create a draft.
  putSavedGroupRevisionMetadata,
  putSavedGroupRevisionCondition,
  putSavedGroupRevisionValues,
  putSavedGroupRevisionArchive,
  postSavedGroupRevisionItemsAdd,
  postSavedGroupRevisionItemsRemove,

  // Review & lifecycle
  postSavedGroupRevisionRequestReview,
  postSavedGroupRevisionSubmitReview,
  getSavedGroupRevisionMergeStatus,
  postSavedGroupRevisionRebase,
  postSavedGroupRevisionPublish,
  postSavedGroupRevisionDiscard,
  postSavedGroupRevisionRevert,
];
