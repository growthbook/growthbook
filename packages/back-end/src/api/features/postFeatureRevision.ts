import {
  postFeatureRevisionValidator,
  ACTIVE_DRAFT_STATUSES,
} from "shared/validators";
import { stringToBoolean } from "shared/util";
import type { ApiRequestLocals } from "back-end/types/api";
import { toApiRevision } from "back-end/src/services/features";
import { dispatchFeatureRevisionEvent } from "back-end/src/services/featureRevisionEvents";
import { ConflictError, NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  countDocuments,
  createRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";
import { auditDetailsCreate } from "back-end/src/services/audit";

export async function createFeatureDraft(
  req: Pick<ApiRequestLocals, "context" | "audit"> & {
    params: { id: string };
    body: { comment?: string; title?: string };
    query?: { overrideDraftLimit?: string | boolean };
  },
) {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (
    !req.context.permissions.canUpdateFeature(feature, {}) ||
    !req.context.permissions.canManageFeatureDrafts(feature)
  ) {
    req.context.permissions.throwPermissionError();
  }

  // Soft per-feature draft cap (org setting). Advisory only — always
  // escapable with ?overrideDraftLimit=true. Automated draft creation
  // (ramps, experiment linkages, reverts, reopens) doesn't pass through
  // this handler and is unaffected.
  const maxDrafts = req.context.org.settings?.maxConcurrentDrafts || 0;
  const overrideDraftLimit = stringToBoolean(
    req.query?.overrideDraftLimit?.toString(),
  );
  if (maxDrafts > 0 && !overrideDraftLimit) {
    const activeDrafts = await countDocuments(req.context.org.id, {
      featureId: feature.id,
      status: [...ACTIVE_DRAFT_STATUSES],
    });
    if (activeDrafts >= maxDrafts) {
      throw new ConflictError(
        `This feature already has ${activeDrafts} active draft${
          activeDrafts === 1 ? "" : "s"
        } and your organization caps drafts at ${maxDrafts} per feature. Retry with ?overrideDraftLimit=true to create the draft anyway, or publish/discard an existing draft first.`,
      );
    }
  }

  const environments = getEnvironmentIdsFromOrg(req.context.org);

  const newDraft = await createRevision({
    context: req.context,
    feature,
    user: req.context.auditUser,
    baseVersion: feature.version,
    comment: req.body.comment ?? "",
    title: req.body.title,
    environments,
    publish: false,
    changes: {},
    org: req.context.org,
    canBypassApprovalChecks: false,
  });

  await req.audit({
    event: "feature.revision.create",
    entity: { object: "feature", id: feature.id },
    details: auditDetailsCreate({
      featureId: feature.id,
      version: newDraft.version,
      baseVersion: newDraft.baseVersion,
      comment: newDraft.comment,
    }),
  });

  await dispatchFeatureRevisionEvent(
    req.context,
    feature,
    newDraft,
    "revision.created",
    {},
  );

  return { feature, revision: newDraft };
}

export const postFeatureRevision = createApiRequestHandler(
  postFeatureRevisionValidator,
)(async (req) => {
  const { feature, revision } = await createFeatureDraft(req);
  return { revision: toApiRevision(revision, req.context, feature) };
});
