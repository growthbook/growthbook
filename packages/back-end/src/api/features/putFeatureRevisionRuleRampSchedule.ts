import { putFeatureRevisionRuleRampScheduleValidator } from "shared/validators";
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
  normalizeInlineRampSchedule,
  resolveOrCreateRevision,
} from "./validations";

export const putFeatureRevisionRuleRampSchedule = createApiRequestHandler(
  putFeatureRevisionRuleRampScheduleValidator,
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
  const { environment, revisionTitle, revisionComment, ...scheduleInput } =
    req.body;
  assertValidEnvironment(req.context, environment);

  const { revision, created } = await resolveOrCreateRevision(
    req.context,
    req.organization.id,
    feature,
    req.params.version,
    { title: revisionTitle, comment: revisionComment },
  );

  try {
    if (!isDraftStatus(revision.status)) {
      throw new BadRequestError(
        `Cannot edit a revision with status "${revision.status}"`,
      );
    }

    // Check draft first, then live — a ramp schedule may target a live rule
    // the draft hasn't touched.
    const inDraft =
      revision.rules?.[environment]?.some((r) => r.id === ruleId) ?? false;
    const inLive =
      feature.environmentSettings?.[environment]?.rules?.some(
        (r) => r.id === ruleId,
      ) ?? false;
    if (!inDraft && !inLive) {
      throw new NotFoundError(
        `Rule "${ruleId}" not found in environment "${environment}"`,
      );
    }

    // Block if an active live schedule already controls this rule.
    const liveSchedules =
      await req.context.models.rampSchedules.findByTargetRule(
        ruleId,
        environment,
      );
    if (liveSchedules.length > 0) {
      throw new BadRequestError(
        `Rule "${ruleId}" already has a live ramp schedule.` +
          ` Update it via PUT /api/v1/ramp-schedules/${liveSchedules[0].id}.`,
      );
    }

    const action = normalizeInlineRampSchedule(
      scheduleInput,
      ruleId,
      environment,
    );

    // Replace any existing pending ramp action for this rule.
    const filtered = (revision.rampActions ?? []).filter(
      (a) => a.ruleId !== ruleId,
    );
    const newRampActions = [...filtered, action];

    await updateRevision(
      req.context,
      feature,
      revision,
      { rampActions: newRampActions },
      {
        user: req.context.auditUser,
        action: "set ramp schedule",
        subject: ruleId,
        value: JSON.stringify(action),
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
      "rule.rampSchedule.set",
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
