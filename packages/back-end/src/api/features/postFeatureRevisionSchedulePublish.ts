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
  resolveArmedPublishUserId,
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
      bypassApproval?: boolean;
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

  // A scheduled publish runs as a resolvable dashboard user at fire time. Reject
  // arming when there is none — e.g. an API key arming a draft also authored by
  // an API key — instead of accepting a schedule the poller can never publish
  // (it would loop on "enabling user could not be resolved").
  if (
    date &&
    !resolveArmedPublishUserId(revision, req.context.userId ?? null)
  ) {
    throw new BadRequestError(
      "Scheduled publishes must run as a user, but this request has no resolvable user actor " +
        "(e.g. an API key scheduling a draft authored by an API key). Arm the schedule from a user session.",
    );
  }

  // Persist the admin bypass-approval intent only when the caller actually has
  // that permission — a requested bypass from a non-admin is silently ignored.
  const bypassApproval =
    !!req.body.bypassApproval &&
    req.context.permissions.canBypassApprovalChecks(feature);

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
      bypassApproval,
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
