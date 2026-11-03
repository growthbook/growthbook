import {
  EventUser,
  eventUserIdentity,
  FeatureRevisionInterface,
  postFeatureRevisionSubmitReviewValidator,
} from "shared/validators";
import { featureReviewCandidateProjects, getReviewSetting } from "shared/util";
import { canCommentOnRevisionEntity } from "shared/permissions";
import {
  getFeatureReviewApproverProjects,
  getFeatureReviewFootprint,
  toApiRevision,
} from "back-end/src/services/features";
import type { ApiReqContext, ApiRequestLocals } from "back-end/types/api";
import { dispatchRevisionReviewEvent } from "back-end/src/services/featureRevisionEvents";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import { mayBeRevisionAuthor } from "back-end/src/revisions/revisionAuthority";
import {
  getRevision,
  ReviewSubmittedType,
  submitReviewAndComments,
} from "back-end/src/models/FeatureRevisionModel";
import { maybeAutoPublishFeatureRevision } from "./autoPublishOnApproval";

export const actionToReviewType: Record<string, ReviewSubmittedType> = {
  approve: "Approved",
  "request-changes": "Requested Changes",
  comment: "Comment",
};

// Log entries that don't change a draft's content. Anything else, including
// actions added later, counts as working on it.
const NON_EDIT_LOG_ACTIONS = new Set([
  "Comment",
  "edit comment",
  "edit title",
  "Approved",
  "Requested Changes",
  "Undo Review",
  "Review Requested",
  "Recall Review",
  "schedule publish",
  "cancel scheduled publish",
  "discard",
  "reopen",
]);

// Who may not rule on a feature draft: its creator, and an org key acting as
// itself on a draft the key created or edited in either mode.
async function isOwnFeatureDraft(
  context: ApiReqContext,
  draft: Pick<FeatureRevisionInterface, "createdBy" | "featureId" | "version">,
): Promise<boolean> {
  const creatorId = eventUserIdentity(draft.createdBy) ?? "";
  if (mayBeRevisionAuthor(creatorId, context.actorId)) return true;
  const key = context.keyActingAsItself;
  if (!key) return false;
  const byKey = (user: EventUser | undefined) =>
    user?.type === "api_key" && user.apiKey === key;
  if (byKey(draft.createdBy)) return true;
  const log =
    await context.models.featureRevisionLogs.getAllByFeatureIdAndVersion({
      featureId: draft.featureId,
      version: draft.version,
    });
  return log.some((e) => !NON_EDIT_LOG_ACTIONS.has(e.action) && byKey(e.user));
}

export async function submitRevisionReview(
  req: Pick<ApiRequestLocals, "context" | "organization"> & {
    params: { id: string; version: number };
    body: {
      action?: "approve" | "request-changes" | "comment";
      comment?: string;
      skipAutoPublish?: boolean;
    };
  },
) {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  const { action = "comment", comment } = req.body;
  const review = actionToReviewType[action];

  // Comments use participation permission; verdicts require review permission.
  // Feature revisions lack an origin snapshot, so comments use the live project.
  if (
    action === "comment"
      ? !canCommentOnRevisionEntity(req.context.permissions, "feature", null, {
          project: feature.project,
        })
      : !req.context.permissions.canReviewFeatureDrafts(
          feature,
          { scope: "any" },
          featureReviewCandidateProjects(feature, req.context.org.settings),
        )
  ) {
    req.context.permissions.throwPermissionError();
  }

  const revision = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    feature,
    version: req.params.version,
  });
  if (!revision) throw new NotFoundError("Could not find feature revision");

  // A verdict is judged against what the draft would change, so this waits on
  // the revision. Comments keep their pre-fetch refusal above.
  if (action !== "comment") {
    const footprint = await getFeatureReviewFootprint({
      context: req.context,
      feature,
      revision,
    });
    if (
      !req.context.permissions.canReviewFeatureDrafts(
        feature,
        footprint,
        await getFeatureReviewApproverProjects({
          context: req.context,
          feature,
          revision,
        }),
      )
    ) {
      req.context.permissions.throwPermissionError();
    }
  }

  if (
    action !== "comment" &&
    (await isOwnFeatureDraft(req.context, revision))
  ) {
    throw new BadRequestError("Cannot submit a review on a draft you created");
  }

  // Block contributors from self-approving when `blockSelfApproval` is set.
  // request-changes / comment are intentionally allowed.
  const requireReviews = req.context.org.settings?.requireReviews;
  const blockSelfApproval = Array.isArray(requireReviews)
    ? !!getReviewSetting(requireReviews, feature)?.blockSelfApproval
    : false;
  // Rechecked inside the verdict CAS against the row it writes.
  if (action === "approve" && blockSelfApproval) {
    const isSelfApproval = (revision.contributors ?? []).some(
      (id) => id === req.context.actorId,
    );
    if (isSelfApproval) {
      throw new BadRequestError(
        "You cannot approve a draft you contributed to.",
      );
    }
  }

  if (
    action !== "comment" &&
    !["pending-review", "changes-requested", "approved"].includes(
      revision.status,
    )
  ) {
    throw new BadRequestError(
      `Can only submit a review when review has been requested (status is "${revision.status}")`,
    );
  }

  const { applied } = await submitReviewAndComments(
    req.context,
    revision,
    req.context.auditUser,
    review,
    comment,
    // Anchor approval to the current live version.
    feature.version,
    blockSelfApproval,
  );
  if (!applied) {
    // The verdict did not persist: a concurrent recall, discard or publish moved
    // the revision out of the review cycle. Refuse rather than log, notify and
    // report success for a review the document does not carry.
    throw new BadRequestError(
      "This revision is no longer in review — it was recalled, published or discarded while the request was in flight.",
    );
  }

  const updated = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    feature,
    version: req.params.version,
  });
  const finalRevision = updated ?? revision;

  await dispatchRevisionReviewEvent(
    req.context,
    feature,
    revision,
    finalRevision,
    review,
    comment,
  );

  if (action === "approve" && !req.body.skipAutoPublish) {
    const afterAutoPublish = await maybeAutoPublishFeatureRevision(
      req.context,
      feature,
      finalRevision,
    );
    const didAutoPublish = afterAutoPublish.status === "published";
    return {
      feature,
      revision: afterAutoPublish,
      autoPublished: didAutoPublish,
    };
  }

  return { feature, revision: finalRevision, autoPublished: false };
}

export const postFeatureRevisionSubmitReview = createApiRequestHandler(
  postFeatureRevisionSubmitReviewValidator,
)(async (req) => {
  const { feature, revision, autoPublished } = await submitRevisionReview(req);
  return {
    revision: toApiRevision(revision, req.context, feature),
    autoPublished,
  };
});
