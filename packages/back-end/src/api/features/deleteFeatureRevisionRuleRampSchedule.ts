import omit from "lodash/omit";
import { z } from "zod";
import type { RevisionRampDetachAction } from "shared/validators";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { isDraftStatus } from "./validations";

export const deleteFeatureRevisionRuleRampSchedule = createApiRequestHandler({
  paramsSchema: z.object({
    id: z.string(),
    version: z.coerce.number().int(),
    ruleId: z.string(),
  }),
  bodySchema: z.object({
    environment: z.string(),
  }),
})(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (
    !req.context.permissions.canUpdateFeature(feature, {}) ||
    !req.context.permissions.canManageFeatureDrafts(feature)
  ) {
    req.context.permissions.throwPermissionError();
  }

  const revision = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    version: req.params.version,
  });
  if (!revision) throw new NotFoundError("Could not find feature revision");

  if (!isDraftStatus(revision.status)) {
    throw new BadRequestError(
      `Cannot edit a revision with status "${revision.status}"`,
    );
  }

  const { ruleId } = req.params;
  const { environment } = req.body;

  const existing = revision.rampActions ?? [];
  const hasPendingCreate = existing.some(
    (a) => a.mode === "create" && a.ruleId === ruleId,
  );

  // Check for a live schedule on this rule
  const liveSchedules = await req.context.models.rampSchedules.findByTargetRule(
    ruleId,
    environment,
  );

  if (!hasPendingCreate && liveSchedules.length === 0) {
    throw new NotFoundError(`Rule "${ruleId}" has no ramp schedule to remove.`);
  }

  // Remove any pending action for this rule
  const filtered = existing.filter((a) => a.ruleId !== ruleId);

  // If there's a live schedule, queue a detach action
  let newRampActions = filtered;
  if (liveSchedules.length > 0) {
    const detach: RevisionRampDetachAction = {
      mode: "detach",
      ruleId,
      rampScheduleId: liveSchedules[0].id,
    };
    newRampActions = [...filtered, detach];
  }

  await updateRevision(
    req.context,
    feature,
    revision,
    { rampActions: newRampActions },
    {
      user: req.context.auditUser,
      action: "clear ramp schedule",
      subject: ruleId,
      value: JSON.stringify({ ruleId, environment }),
    },
    false,
  );

  const updated = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    version: req.params.version,
  });

  return { revision: omit(updated ?? revision, "organization") };
});
