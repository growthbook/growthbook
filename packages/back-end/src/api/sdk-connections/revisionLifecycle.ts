import {
  postSdkConnectionRevisionDiscardValidator,
  postSdkConnectionRevisionRebaseValidator,
  postSdkConnectionRevisionRecallReviewValidator,
  postSdkConnectionRevisionReopenValidator,
  postSdkConnectionRevisionRequestReviewValidator,
  postSdkConnectionRevisionSchedulePublishValidator,
  postSdkConnectionRevisionSubmitReviewValidator,
  postSdkConnectionRevisionUndoReviewValidator,
} from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  discardEntityRevision,
  rebaseRevision,
  requestRevisionReview,
  submitRevisionReview,
} from "back-end/src/revisions/revisionActions";
import {
  recallRevisionReview,
  reopenRevision,
  scheduleRevisionPublish,
  undoRevisionReview,
} from "back-end/src/revisions/revisionLifecycle";
import {
  confirmationLink,
  requireConfirmation,
} from "back-end/src/services/confirmations";
import {
  TYPE,
  loadConnectionAndRevision,
  toApiSdkConnectionRevision,
} from "./revisionShared";

export const postSdkConnectionRevisionRequestReview = createApiRequestHandler(
  postSdkConnectionRevisionRequestReviewValidator,
)(async (req) => {
  const { context } = req;
  const { live, revision } = await loadConnectionAndRevision(
    context,
    req.params,
  );
  const { autoPublishOnApproval } = req.body;
  await requireConfirmation(context, {
    actions: autoPublishOnApproval
      ? ["sdkConnection.draft", "sdkConnection.edit"]
      : ["sdkConnection.draft"],
    environments: [live.sdkConnection.environment],
    summary: `Request review of revision ${revision.version} of ${live.sdkConnection.name}`,
    links: [
      confirmationLink("sdkConnection", live.id, live.sdkConnection.name),
    ],
    pin: revision.dateUpdated,
  });
  const updated = await requestRevisionReview({
    context,
    entityType: TYPE,
    entity: live,
    revision,
    autoPublishOnApproval,
  });
  return { revision: await toApiSdkConnectionRevision(context, updated) };
});

export const postSdkConnectionRevisionSubmitReview = createApiRequestHandler(
  postSdkConnectionRevisionSubmitReviewValidator,
)(async (req) => {
  const { context } = req;
  const { live, revision } = await loadConnectionAndRevision(
    context,
    req.params,
  );
  const { revision: updated, autoPublished } = await submitRevisionReview({
    context,
    entityType: TYPE,
    entity: live,
    revision,
    decision: req.body.decision,
    comment: req.body.comment,
    skipAutoPublish: req.body.skipAutoPublish,
  });
  return {
    revision: await toApiSdkConnectionRevision(context, updated),
    autoPublished,
  };
});

export const postSdkConnectionRevisionRecallReview = createApiRequestHandler(
  postSdkConnectionRevisionRecallReviewValidator,
)(async (req) => {
  const { context } = req;
  const { revision } = await loadConnectionAndRevision(context, req.params);
  const updated = await recallRevisionReview({ context, type: TYPE, revision });
  return { revision: await toApiSdkConnectionRevision(context, updated) };
});

export const postSdkConnectionRevisionUndoReview = createApiRequestHandler(
  postSdkConnectionRevisionUndoReviewValidator,
)(async (req) => {
  const { context } = req;
  const { live, revision } = await loadConnectionAndRevision(
    context,
    req.params,
  );
  const updated = await undoRevisionReview({
    context,
    type: TYPE,
    entity: live,
    revision,
  });
  return { revision: await toApiSdkConnectionRevision(context, updated) };
});

export const postSdkConnectionRevisionReopen = createApiRequestHandler(
  postSdkConnectionRevisionReopenValidator,
)(async (req) => {
  const { context } = req;
  const { revision } = await loadConnectionAndRevision(context, req.params);
  const updated = await reopenRevision({ context, type: TYPE, revision });
  return { revision: await toApiSdkConnectionRevision(context, updated) };
});

export const postSdkConnectionRevisionRebase = createApiRequestHandler(
  postSdkConnectionRevisionRebaseValidator,
)(async (req) => {
  const { context } = req;
  const { live, revision } = await loadConnectionAndRevision(
    context,
    req.params,
  );
  const updated = await rebaseRevision({
    context,
    entityType: TYPE,
    entity: live,
    revision,
    strategies: req.body.conflictResolutions ?? {},
  });
  return { revision: await toApiSdkConnectionRevision(context, updated) };
});

export const postSdkConnectionRevisionSchedulePublish = createApiRequestHandler(
  postSdkConnectionRevisionSchedulePublishValidator,
)(async (req) => {
  const { context } = req;
  const { live, revision } = await loadConnectionAndRevision(
    context,
    req.params,
  );
  const updated = await scheduleRevisionPublish({
    context,
    type: TYPE,
    entity: live,
    revision,
    body: req.body,
  });
  return { revision: await toApiSdkConnectionRevision(context, updated) };
});

export const postSdkConnectionRevisionDiscard = createApiRequestHandler(
  postSdkConnectionRevisionDiscardValidator,
)(async (req) => {
  const { context } = req;
  const { revision } = await loadConnectionAndRevision(context, req.params);
  const updated = await discardEntityRevision({
    context,
    entityType: TYPE,
    revision,
    reason: req.body.reason,
  });
  return { revision: await toApiSdkConnectionRevision(context, updated) };
});
