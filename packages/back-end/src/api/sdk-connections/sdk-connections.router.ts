import { OpenApiRoute } from "back-end/src/util/handler";
import { getSdkConnection } from "./getSdkConnection";
import { listSdkConnections } from "./listSdkConnections";
import { postSdkConnection } from "./postSdkConnection";
import { putSdkConnection } from "./putSdkConnection";
import { deleteSdkConnection } from "./deleteSdkConnection";
import { lookupSdkConnectionByKey } from "./lookupSdkConnectionByKey";
import {
  getSdkConnectionRevision,
  getSdkConnectionRevisionLatest,
  getSdkConnectionRevisionMergeStatus,
  getSdkConnectionRevisions,
  listSdkConnectionRevisions,
} from "./revisionReads";
import {
  deleteSdkConnectionRevisionWebhook,
  postSdkConnectionRevision,
  postSdkConnectionRevisionWebhook,
  putSdkConnectionRevisionArchive,
  putSdkConnectionRevisionSettings,
  putSdkConnectionRevisionWebhook,
} from "./revisionEdits";
import {
  postSdkConnectionRevisionDiscard,
  postSdkConnectionRevisionRebase,
  postSdkConnectionRevisionRecallReview,
  postSdkConnectionRevisionReopen,
  postSdkConnectionRevisionRequestReview,
  postSdkConnectionRevisionSchedulePublish,
  postSdkConnectionRevisionSubmitReview,
  postSdkConnectionRevisionUndoReview,
} from "./revisionLifecycle";
import { postSdkConnectionRevisionPublish } from "./postSdkConnectionRevisionPublish";
import { postSdkConnectionRevisionRevert } from "./postSdkConnectionRevisionRevert";

export const sdkConnectionsRoutes: OpenApiRoute[] = [
  listSdkConnections,
  postSdkConnection,
  getSdkConnection,
  putSdkConnection,
  deleteSdkConnection,
  lookupSdkConnectionByKey,

  // Revisions. `latest` precedes `:version`, which would otherwise take it.
  listSdkConnectionRevisions,
  getSdkConnectionRevisions,
  getSdkConnectionRevisionLatest,
  getSdkConnectionRevision,
  getSdkConnectionRevisionMergeStatus,
  postSdkConnectionRevision,
  putSdkConnectionRevisionSettings,
  putSdkConnectionRevisionArchive,
  postSdkConnectionRevisionWebhook,
  putSdkConnectionRevisionWebhook,
  deleteSdkConnectionRevisionWebhook,
  postSdkConnectionRevisionRequestReview,
  postSdkConnectionRevisionSubmitReview,
  postSdkConnectionRevisionRecallReview,
  postSdkConnectionRevisionUndoReview,
  postSdkConnectionRevisionReopen,
  postSdkConnectionRevisionSchedulePublish,
  postSdkConnectionRevisionRebase,
  postSdkConnectionRevisionPublish,
  postSdkConnectionRevisionDiscard,
  postSdkConnectionRevisionRevert,
];
