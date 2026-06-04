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

export async function requestReview(
  req: Pick<ApiRequestLocals, "context" | "organization" | "audit"> & {
    params: { id: string; version: number };
    body: { comment?: string };
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

  await markRevisionAsReviewRequested(
    req.context,
    revision,
    req.context.auditUser,
    req.body.comment ?? "",
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
