import { postFeatureRevisionDiscardValidator } from "shared/validators";
import type { ApiRequestLocals } from "back-end/types/api";
import { toApiRevision } from "back-end/src/services/features";
import { dispatchFeatureRevisionEvent } from "back-end/src/services/featureRevisionEvents";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import { clearPendingFeatureDraftsForRevision } from "back-end/src/models/ExperimentModel";
import {
  discardRevision,
  getRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { canDiscardFeatureDraft } from "back-end/src/revisions/featureDraftAuthority";

export async function discardFeatureRevision(
  req: Pick<ApiRequestLocals, "context" | "organization" | "audit"> & {
    params: { id: string; version: number };
  },
) {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  const revision = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    feature,
    version: req.params.version,
  });
  if (!revision) throw new NotFoundError("Could not find feature revision");

  if (revision.status === "published" || revision.status === "discarded") {
    throw new BadRequestError(`Cannot discard a ${revision.status} revision`);
  }

  if (
    !(await canDiscardFeatureDraft({
      context: req.context,
      feature,
      draft: revision,
    }))
  ) {
    req.context.permissions.throwPermissionError();
  }

  // feature.version lets discardRevision refuse to discard the revision the
  // feature is live on (#6483) — that discard is what turns a recoverable
  // stranded state into permanent corruption.
  await discardRevision(
    req.context,
    revision,
    req.context.auditUser,
    feature.version,
  );
  await clearPendingFeatureDraftsForRevision(
    req.context,
    feature.id,
    revision.version,
    revision.rules,
  );

  // linkedFeatures is intentionally preserved on discard — the experiment page
  // shows a "discarded" callout so the user can re-add or remove manually.
  // pendingFeatureDrafts is cleared above; syncFeatureExperimentLinkages
  // (fired from discardRevision) handles any remaining reconciliation.

  const updated = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    feature,
    version: req.params.version,
  });
  const finalRevision = updated ?? revision;

  await req.audit({
    event: "feature.revision.discard",
    entity: { object: "feature", id: feature.id },
    details: auditDetailsUpdate(
      { status: revision.status },
      { status: finalRevision.status },
      { version: revision.version },
    ),
  });

  await dispatchFeatureRevisionEvent(
    req.context,
    feature,
    finalRevision,
    "revision.discarded",
    {},
  );

  return { feature, revision: finalRevision };
}

export const postFeatureRevisionDiscard = createApiRequestHandler(
  postFeatureRevisionDiscardValidator,
)(async (req) => {
  const { feature, revision } = await discardFeatureRevision(req);
  return { revision: toApiRevision(revision, req.context, feature) };
});
