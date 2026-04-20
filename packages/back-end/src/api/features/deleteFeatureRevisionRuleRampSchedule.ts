import type { RevisionRampDetachAction } from "shared/validators";
import { deleteFeatureRevisionRuleRampScheduleValidator } from "shared/validators";
import { resetReviewOnChange } from "shared/util";
import { toApiRevision } from "back-end/src/services/features";
import { recordRevisionUpdate } from "back-end/src/services/featureRevisionEvents";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import {
  getApplicableEnvIds,
  resolveRampTarget,
  ruleFootprint,
} from "back-end/src/util/flattenRules";
import { getEnvironments } from "back-end/src/util/organization.util";
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
  if (environment) assertValidEnvironment(req.context, environment);

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

    // Resolve the rule so we have a canonical id for all persisted references
    // (rampAction.ruleId filter, detach action, audit subject, event payload).
    // Canonical id is `match.id` when the rule still exists on draft or live;
    // when the rule is gone entirely we fall back to the caller's ruleId so
    // stale pending actions can still be cleaned up.
    const resolvedRule =
      resolveRampTarget(
        { ruleId, environment: environment ?? null },
        revision.rules ?? [],
      ) ??
      resolveRampTarget(
        { ruleId, environment: environment ?? null },
        feature.rules ?? [],
      );
    const canonicalRuleId = resolvedRule?.id ?? ruleId;

    const existing = revision.rampActions ?? [];
    // Tolerant match: a pending create may have been recorded under either the
    // canonical or the caller-provided form (legacy writes could drift).
    const hasPendingCreate = existing.some(
      (a) =>
        a.mode === "create" &&
        (a.ruleId === canonicalRuleId || a.ruleId === ruleId),
    );

    const liveSchedules =
      await req.context.models.rampSchedules.findByTargetRule(
        canonicalRuleId,
        environment ?? undefined,
      );

    if (!hasPendingCreate && liveSchedules.length === 0) {
      throw new NotFoundError(
        `Rule "${canonicalRuleId}" has no ramp schedule to remove.`,
      );
    }

    const filtered = existing.filter(
      (a) => a.ruleId !== canonicalRuleId && a.ruleId !== ruleId,
    );

    // Queue a detach action if a live schedule exists.
    let newRampActions = filtered;
    if (liveSchedules.length > 0) {
      const detach: RevisionRampDetachAction = {
        mode: "detach",
        ruleId: canonicalRuleId,
        rampScheduleId: liveSchedules[0].id,
      };
      newRampActions = [...filtered, detach];
    }

    // Affected env list: explicit env if provided, else the rule's footprint
    // across applicable envs (falls back to all applicable envs if the rule
    // isn't present on live or draft).
    const orgEnvs = getEnvironments(req.organization);
    const applicableEnvs = getApplicableEnvIds(orgEnvs, feature.project);
    const changedEnvironments = environment
      ? [environment]
      : resolvedRule
        ? ruleFootprint(resolvedRule, applicableEnvs)
        : applicableEnvs;

    await updateRevision(
      req.context,
      feature,
      revision,
      { rampActions: newRampActions },
      {
        user: req.context.auditUser,
        action: "clear ramp schedule",
        subject: canonicalRuleId,
        value: JSON.stringify({ ruleId: canonicalRuleId, environment }),
      },
      resetReviewOnChange({
        feature,
        changedEnvironments,
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
        environments: changedEnvironments,
        auditDetails: { ruleId: canonicalRuleId },
      },
    );

    return { revision: toApiRevision(finalRevision, req.context, feature) };
  } catch (err) {
    await discardIfJustCreated(req.context, revision, created);
    throw err;
  }
});
