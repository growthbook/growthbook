import omit from "lodash/omit";
import { postFeatureRevisionReviewValidator } from "shared/validators";
import { getReviewSetting } from "shared/util";
import {
  EventUserApiKey,
  EventUserLoggedIn,
} from "shared/types/events/event-types";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  markRevisionAsReviewRequested,
  submitReviewAndComments,
} from "back-end/src/models/FeatureRevisionModel";

export const postFeatureRevisionReview = createApiRequestHandler(
  postFeatureRevisionReviewValidator,
)(async (req) => {
  const { id, version } = req.params;
  const { review, comment } = req.body;
  const context = req.context;

  const feature = await getFeature(context, id);
  if (!feature) {
    throw new Error(`Feature id '${id}' not found.`);
  }

  if (!context.permissions.canReviewFeatureDrafts(feature)) {
    context.permissions.throwPermissionError();
  }

  const revision = await getRevision({
    context,
    organization: context.org.id,
    featureId: feature.id,
    version,
  });
  if (!revision) {
    throw new Error(`Revision ${version} not found for feature '${id}'.`);
  }

  // The internal review endpoint only accepts pending-review / changes-requested / approved
  // (plus draft status implicitly via the separate submit-for-review endpoint). For the
  // REST API we collapse these into a single call: a non-comment review on a `draft`
  // implicitly submits-for-review and then applies the requested transition.
  const allowedStatuses = [
    "draft",
    "pending-review",
    "changes-requested",
    "approved",
  ] as const;
  if (
    review !== "Comment" &&
    !allowedStatuses.includes(
      revision.status as (typeof allowedStatuses)[number],
    )
  ) {
    throw new Error(`Cannot review a revision in status '${revision.status}'.`);
  }

  // Self-review check: an API key (or its associated user) cannot non-Comment-review
  // its own draft. Match by apiKey for api_key actors, and by user id for dashboard actors.
  const eventAudit = req.eventAudit;
  if (review !== "Comment" && eventAudit) {
    const createdBy = revision.createdBy;
    if (createdBy) {
      if (
        createdBy.type === "api_key" &&
        eventAudit.type === "api_key" &&
        (createdBy as EventUserApiKey).apiKey ===
          (eventAudit as EventUserApiKey).apiKey
      ) {
        throw new Error("Cannot submit a review for your own draft.");
      }
      if (
        createdBy.type === "dashboard" &&
        req.user &&
        (createdBy as EventUserLoggedIn).id === req.user.id
      ) {
        throw new Error("Cannot submit a review for your own draft.");
      }
    }
  }

  // Block contributor self-approval when org enables it (mirrors internal flow).
  if (review === "Approved") {
    const requireReviews = context.org.settings?.requireReviews;
    const reviewSetting = Array.isArray(requireReviews)
      ? getReviewSetting(requireReviews, feature)
      : undefined;
    if (reviewSetting?.blockSelfApproval) {
      const callerApiKey =
        eventAudit && eventAudit.type === "api_key"
          ? (eventAudit as EventUserApiKey).apiKey
          : null;
      const callerUserId = req.user?.id ?? null;
      const isContributor = (revision.contributors ?? []).some((c) => {
        if (!c) return false;
        if (c.type === "api_key" && callerApiKey) {
          return (c as EventUserApiKey).apiKey === callerApiKey;
        }
        if (c.type === "dashboard" && callerUserId) {
          return (c as EventUserLoggedIn).id === callerUserId;
        }
        return false;
      });
      if (isContributor) {
        throw new Error(
          "Cannot approve a draft you contributed to (org setting 'blockSelfApproval' is enabled).",
        );
      }
    }
  }

  // If the revision is still a draft, first transition it to pending-review so the
  // status history shows the implicit submit step. Skip this for "Comment" reviews
  // — those should not move a draft into review.
  if (revision.status === "draft" && review !== "Comment") {
    await markRevisionAsReviewRequested(context, revision, eventAudit);
    revision.status = "pending-review";
  }

  await submitReviewAndComments(context, revision, eventAudit, review, comment);

  const updated = await getRevision({
    context,
    organization: context.org.id,
    featureId: feature.id,
    version,
  });
  if (!updated) {
    throw new Error("Failed to load updated revision.");
  }

  return {
    revision: omit(updated, "organization"),
  };
});
