import { postFeatureRevisionRequestReviewValidator } from "shared/validators";
import { draftDiffersFromLive, filterEnvironmentsByFeature } from "shared/util";
import type { ApiRequestLocals } from "back-end/types/api";
import {
  toApiRevision,
  getLiveAndBaseRevisionsForFeature,
} from "back-end/src/services/features";
import { dispatchFeatureRevisionEvent } from "back-end/src/services/featureRevisionEvents";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  markRevisionAsReviewRequested,
} from "back-end/src/models/FeatureRevisionModel";
import { getEnvironments } from "back-end/src/util/organization.util";
import {
  canEnableFeatureAutoPublishOnApproval,
  canScheduleFeaturePublish,
  parseScheduledPublishDate,
  resolveArmedPublishUserId,
} from "./autoPublishOnApproval";

export async function requestReview(
  req: Pick<ApiRequestLocals, "context" | "organization" | "audit"> & {
    params: { id: string; version: number };
    body: {
      comment?: string;
      autoPublishOnApproval?: boolean;
      scheduledPublishAt?: string | null;
      scheduledPublishLockEdits?: boolean;
      scheduledPublishLockOthers?: boolean;
    };
  },
) {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  // Gated on canManageFeatureDrafts only so contributors can request approval
  // on drafts they can't publish themselves.
  if (!req.context.permissions.canManageFeatureDrafts(feature)) {
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

  if (revision.status !== "draft") {
    throw new BadRequestError(
      `Can only request review on a draft (status is "${revision.status}")`,
    );
  }

  const allEnvironments = getEnvironments(req.context.org);
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const environmentIds = environments.map((e) => e.id);
  const { live } = await getLiveAndBaseRevisionsForFeature({
    context: req.context,
    feature,
    revision,
  });
  const hasLinkedPendingRamp =
    (
      await req.context.models.rampSchedules.findByActivatingRevision(
        feature.id,
        revision.version,
      )
    ).length > 0;
  const hasChanges =
    draftDiffersFromLive(revision, live, feature, environmentIds) ||
    hasLinkedPendingRamp;
  if (!hasChanges) {
    throw new BadRequestError(
      "Cannot request review: no changes detected in this revision",
    );
  }

  const enableAutoPublish =
    req.body.autoPublishOnApproval &&
    canEnableFeatureAutoPublishOnApproval(req.context, feature);

  const scheduledDate = parseScheduledPublishDate(req.body.scheduledPublishAt);
  if (
    scheduledDate !== null &&
    !canScheduleFeaturePublish(req.context, feature)
  ) {
    req.context.permissions.throwPermissionError();
  }

  // A scheduled publish runs as a resolvable dashboard user at fire time. Reject
  // arming when there is none (e.g. an API key requesting review with a schedule
  // on a draft authored by an API key) so the poller doesn't loop forever on
  // "enabling user could not be resolved". Mirrors the schedule-publish endpoint.
  if (
    scheduledDate !== null &&
    !resolveArmedPublishUserId(revision, req.context.userId ?? null)
  ) {
    throw new BadRequestError(
      "Scheduled publishes must run as a user, but this request has no resolvable user actor " +
        "(e.g. an API key scheduling a draft authored by an API key). Arm the schedule from a user session.",
    );
  }

  await markRevisionAsReviewRequested(
    req.context,
    revision,
    req.context.auditUser,
    req.body.comment ?? "",
    {
      autoPublishOnApproval: enableAutoPublish,
      scheduledPublishAt: scheduledDate,
      scheduledPublishLockEdits: req.body.scheduledPublishLockEdits,
      scheduledPublishLockOthers: req.body.scheduledPublishLockOthers,
    },
  );

  const updated = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    feature,
    version: req.params.version,
  });
  const finalRevision = updated ?? revision;

  await req.audit({
    event: "feature.revision.requestReview",
    entity: { object: "feature", id: feature.id },
    details: auditDetailsUpdate(
      { status: revision.status },
      { status: finalRevision.status },
      { version: revision.version, comment: req.body.comment ?? "" },
    ),
  });

  await dispatchFeatureRevisionEvent(
    req.context,
    feature,
    finalRevision,
    "revision.reviewRequested",
    { reviewComment: req.body.comment ?? null },
  );

  return { feature, revision: finalRevision };
}

export const postFeatureRevisionRequestReview = createApiRequestHandler(
  postFeatureRevisionRequestReviewValidator,
)(async (req) => {
  const { feature, revision } = await requestReview(req);
  return { revision: toApiRevision(revision, req.context, feature) };
});
