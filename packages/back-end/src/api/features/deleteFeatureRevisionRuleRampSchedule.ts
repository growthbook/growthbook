import type { OrganizationInterface } from "shared/types/organization";
import type { RevisionRampDetachAction } from "shared/validators";
import { deleteFeatureRevisionRuleRampScheduleValidator } from "shared/validators";
import { resetReviewOnChange } from "shared/util";
import type { ApiReqContext } from "back-end/types/api";
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

export async function clearRuleRampSchedule(
  context: ApiReqContext,
  organization: OrganizationInterface,
  params: { id: string; version: number | "new"; ruleId: string },
  body: {
    environment?: string;
    revisionTitle?: string;
    revisionComment?: string;
  },
) {
  const feature = await getFeature(context, params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (
    !context.permissions.canUpdateFeature(feature, {}) ||
    !context.permissions.canManageFeatureDrafts(feature)
  ) {
    context.permissions.throwPermissionError();
  }

  const { ruleId } = params;
  const { environment } = body;
  if (environment) assertValidEnvironment(context, environment);

  const { revision, created } = await resolveOrCreateRevision(
    context,
    organization.id,
    feature,
    params.version,
    { title: body.revisionTitle, comment: body.revisionComment },
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

    const liveSchedules = await context.models.rampSchedules.findByTargetRule(
      canonicalRuleId,
      environment ?? undefined,
    );

    if (!hasPendingCreate && liveSchedules.length === 0) {
      throw new NotFoundError(
        `Rule "${canonicalRuleId}" has no ramp schedule to remove.`,
      );
    }

    const filtered = existing.filter(
      (a) =>
        !("ruleId" in a) ||
        (a.ruleId !== canonicalRuleId && a.ruleId !== ruleId),
    );

    // Queue a detach action if a live schedule exists.
    let newRampActions = filtered;
    if (liveSchedules.length > 0) {
      const detach: RevisionRampDetachAction = {
        mode: "detach",
        ruleId: canonicalRuleId,
        rampScheduleId: liveSchedules[0].id,
        deleteScheduleWhenEmpty: true,
      };
      newRampActions = [...filtered, detach];
    }

    // Affected env list: explicit env if provided, else the rule's footprint
    // across applicable envs (falls back to all applicable envs if the rule
    // isn't present on live or draft).
    const orgEnvs = getEnvironments(organization);
    const applicableEnvs = getApplicableEnvIds(orgEnvs, feature.project);
    const changedEnvironments = environment
      ? [environment]
      : resolvedRule
        ? ruleFootprint(resolvedRule, applicableEnvs)
        : applicableEnvs;

    await updateRevision(
      context,
      feature,
      revision,
      { rampActions: newRampActions },
      {
        user: context.auditUser,
        action: "clear ramp schedule",
        subject: canonicalRuleId,
        value: JSON.stringify({ ruleId: canonicalRuleId, environment }),
      },
      resetReviewOnChange({
        feature,
        changedEnvironments,
        defaultValueChanged: false,
        settings: organization.settings,
      }),
    );

    const updated = await getRevision({
      context,
      organization: organization.id,
      featureId: feature.id,
      feature,
      version: revision.version,
    });
    const finalRevision = updated ?? revision;

    await recordRevisionUpdate(
      context,
      feature,
      finalRevision,
      "rule.rampSchedule.remove",
      {
        environments: changedEnvironments,
        auditDetails: { ruleId: canonicalRuleId },
      },
    );

    return { feature, revision: finalRevision };
  } catch (err) {
    await discardIfJustCreated(context, revision, created);
    throw err;
  }
}

export const deleteFeatureRevisionRuleRampSchedule = createApiRequestHandler(
  deleteFeatureRevisionRuleRampScheduleValidator,
)(async (req) => {
  const { feature, revision } = await clearRuleRampSchedule(
    req.context,
    req.organization,
    req.params,
    req.body,
  );
  return { revision: toApiRevision(revision, req.context, feature) };
});
