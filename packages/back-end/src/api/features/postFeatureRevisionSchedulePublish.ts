import type { ApiRequestLocals } from "back-end/types/api";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  setRevisionScheduledPublish,
} from "back-end/src/models/FeatureRevisionModel";
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

// Arm or cancel a deferred publish on a revision. Send scheduledPublishAt: null
// to cancel. Shared core for the REST handler.
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
  // Arming requires the premium feature + publish authority. Cancelling a
  // pending schedule needs only publish authority — anyone who can publish the
  // feature can call off (or take over) the deferred publish, leaving the
  // revision at its current (approved) status.
  const allowed = date
    ? canScheduleFeaturePublish(req.context, feature)
    : canPublishFeatureRevision(req.context, feature);
  if (!allowed) {
    req.context.permissions.throwPermissionError();
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
