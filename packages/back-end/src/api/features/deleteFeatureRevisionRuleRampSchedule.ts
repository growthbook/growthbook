import type { RevisionRampDetachAction } from "shared/validators";
import { deleteFeatureRevisionRuleRampScheduleValidator } from "shared/validators";
import { resetReviewOnChange } from "shared/util";
import { revisionToApiInterface } from "back-end/src/services/features";
import { recordRevisionUpdate } from "back-end/src/services/featureRevisionEvents";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import {
  assertValidEnvironment,
  discardIfJustCreated,
  isDraftStatus,
  resolveOrCreateRevision,
} from "./validations";

export const deleteFeatureRevisionRuleRampSchedule = createApiRequestHandler(
  deleteFeatureRevisionRuleRampScheduleValidator,
)(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (
    !req.context.permissions.canUpdateFeature(feature, {}) ||
    !req.context.permissions.canManageFeatureDrafts(feature)
  ) {
    req.context.permissions.throwPermissionError();
  }

  const { ruleId } = req.params;
  const { environment } = req.body;
  assertValidEnvironment(req.context, environment);

  const { revision, created } = await resolveOrCreateRevision(
    req.context,
    req.organization.id,
    feature,
    req.params.version,
    { title: req.body.revisionTitle, comment: req.body.revisionComment },
  );

  try {
    if (!isDraftStatus(revision.status)) {
      throw new BadRequestError(
        `Cannot edit a revision with status "${revision.status}"`,
      );
    }

    const existing = revision.rampActions ?? [];
    const hasPendingCreate = existing.some(
      (a) => a.mode === "create" && a.ruleId === ruleId,
    );

    const liveSchedules =
      await req.context.models.rampSchedules.findByTargetRule(
        ruleId,
        environment,
      );

    if (!hasPendingCreate && liveSchedules.length === 0) {
      throw new NotFoundError(
        `Rule "${ruleId}" has no ramp schedule to remove.`,
      );
    }

    const filtered = existing.filter((a) => a.ruleId !== ruleId);

    // Queue a detach action if a live schedule exists.
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
      resetReviewOnChange({
        feature,
        changedEnvironments: [environment],
        defaultValueChanged: false,
        settings: req.organization.settings,
      }),
    );

    const updated = await getRevision({
      context: req.context,
      organization: req.organization.id,
      featureId: feature.id,
      version: revision.version,
    });
    const finalRevision = updated ?? revision;

    await recordRevisionUpdate(
      req.context,
      feature,
      finalRevision,
      "rule.rampSchedule.remove",
      {
        environments: [environment],
        auditDetails: { ruleId },
      },
    );

    return { revision: revisionToApiInterface(finalRevision) };
  } catch (err) {
    await discardIfJustCreated(req.context, revision, created);
    throw err;
  }
});
