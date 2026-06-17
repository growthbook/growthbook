import type { ApiRequestLocals } from "back-end/types/api";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  setRevisionScheduledPublish,
} from "back-end/src/models/FeatureRevisionModel";
import { revisionRequiresReview } from "back-end/src/services/features";
import {
  canPublishFeatureRevision,
  canScheduleFeaturePublish,
  parseScheduledPublishDate,
} from "./autoPublishOnApproval";

const SCHEDULABLE_STATUSES = [
  "draft",
  "pending-review",
  "changes-requested",
  "approved",
];

// Arm or cancel a deferred publish on a revision (scheduledPublishAt: null cancels).
export async function schedulePublish(
  req: Pick<ApiRequestLocals, "context" | "organization"> & {
    params: { id: string; version: number };
    body: {
      scheduledPublishAt: string | null;
      lockEdits?: boolean;
      lockOthers?: boolean;
    };
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

  if (!SCHEDULABLE_STATUSES.includes(revision.status)) {
    throw new BadRequestError(
      `Cannot schedule publish on a revision with status "${revision.status}"`,
    );
  }

  const date = parseScheduledPublishDate(req.body.scheduledPublishAt);
  // Arming needs the premium feature + publish authority; canceling needs only
  // publish authority.
  const allowed = date
    ? canScheduleFeaturePublish(req.context, feature)
    : canPublishFeatureRevision(req.context, feature);
  if (!allowed) {
    req.context.permissions.throwPermissionError();
  }

  // Committing a schedule on a draft is the no-approval path (fires without a
  // review cycle). Only allow it when the change doesn't require review, failing
  // closed if the base can't be resolved. Review-required drafts arm via
  // request-review instead.
  if (date && revision.status === "draft") {
    const requiresReview = await revisionRequiresReview(
      req.context,
      feature,
      revision,
      { treatUnresolvedBaseAsReview: true },
    );
    if (
      requiresReview &&
      !req.context.permissions.canBypassApprovalChecks(feature)
    ) {
      throw new BadRequestError(
        "This change requires approval — request review to schedule its publish.",
      );
    }
  }

  await setRevisionScheduledPublish(
    req.context,
    revision,
    {
      scheduledPublishAt: date,
      lockEdits: req.body.lockEdits,
      lockOthers: req.body.lockOthers,
    },
    req.context.userId || null,
  );

  const updated = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    feature,
    version: req.params.version,
  });

  return { feature, revision: updated ?? revision };
}
