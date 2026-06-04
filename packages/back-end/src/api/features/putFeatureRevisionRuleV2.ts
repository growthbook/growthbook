import isEqual from "lodash/isEqual";
import { resetReviewOnChange } from "shared/util";
import {
  RevisionRampCreateAction,
  RevisionRampUpdateAction,
  SafeRolloutRule,
  FeatureRule,
  RulePatchInput,
  putFeatureRevisionRuleV2Validator,
  RulePatchInputV2,
} from "shared/validators";
import { RevisionChanges } from "shared/types/feature-revision";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { recordRevisionUpdate } from "back-end/src/services/featureRevisionEvents";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import {
  discardIfJustCreated,
  isDraftStatus,
  normalizeInlineRampSchedule,
  buildScheduleRampAction,
  validateRuleAttributes,
  validateRuleConditions,
  validateRuleReferences,
  resolveOrCreateRevision,
} from "./validations";
import { applyPatch } from "./putFeatureRevisionRule";
import { resolveScopeFromInput } from "./v2Shared";

export const putFeatureRevisionRuleV2 = createApiRequestHandler(
  putFeatureRevisionRuleV2Validator,
)(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (
    !req.context.permissions.canUpdateFeature(feature, {}) ||
    !req.context.permissions.canManageFeatureDrafts(feature)
  ) {
    req.context.permissions.throwPermissionError();
  }

  const { schedule } = req.body;
  const inlineRampSchedule = req.body.rampSchedule;
  const patch = req.body.rule as RulePatchInputV2;

  if (inlineRampSchedule && (schedule?.startDate || schedule?.endDate)) {
    throw new BadRequestError(
      "rampSchedule and schedule are mutually exclusive. Provide one or the other, not both.",
    );
  }

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

    // V2: find rule by ruleId directly in flat array (no env filter).
    const flatRules: FeatureRule[] = revision.rules ?? [];
    const idx = flatRules.findIndex((r) => r.id === req.params.ruleId);
    if (idx === -1) {
      throw new NotFoundError(`Rule "${req.params.ruleId}" not found`);
    }

    const oldRule = flatRules[idx];

    if (oldRule.type === "safe-rollout") {
      const safeRollout = await req.context.models.safeRollout.getById(
        (oldRule as SafeRolloutRule).safeRolloutId,
      );
      if (safeRollout?.startedAt !== undefined) {
        const immutableFieldChanges: string[] = [];
        if (
          patch.controlValue !== undefined &&
          !isEqual(
            patch.controlValue,
            (oldRule as SafeRolloutRule).controlValue,
          )
        )
          immutableFieldChanges.push("controlValue");
        if (
          patch.variationValue !== undefined &&
          !isEqual(
            patch.variationValue,
            (oldRule as SafeRolloutRule).variationValue,
          )
        )
          immutableFieldChanges.push("variationValue");
        if (
          patch.hashAttribute !== undefined &&
          !isEqual(
            patch.hashAttribute,
            (oldRule as SafeRolloutRule).hashAttribute,
          )
        )
          immutableFieldChanges.push("hashAttribute");
        if (patch.seed !== undefined && !isEqual(patch.seed, oldRule.seed))
          immutableFieldChanges.push("seed");
        if (immutableFieldChanges.length > 0) {
          throw new BadRequestError(
            `Cannot update the following fields after a Safe Rollout has started: ${immutableFieldChanges.join(", ")}`,
          );
        }
      }
    }

    const wantsNewSchedule =
      Boolean(inlineRampSchedule) ||
      (!inlineRampSchedule &&
        (Boolean(schedule?.startDate) || Boolean(schedule?.endDate)));
    let liveSchedulesForRule: Awaited<
      ReturnType<typeof req.context.models.rampSchedules.findByTargetRule>
    > = [];
    if (wantsNewSchedule) {
      liveSchedulesForRule =
        await req.context.models.rampSchedules.findByTargetRule(
          req.params.ruleId,
          undefined,
        );
    }

    // Apply patch including v2 scope fields.
    const { allEnvironments, environments, ...basePatch } = patch;
    const updatedRule = applyPatch(oldRule, basePatch as RulePatchInput);

    // Apply scope changes if present. When the client sends only
    // `environments` (without `allEnvironments`), infer `allEnvironments:false`
    // — the user explicitly listed envs, so they want single/multi-env scope
    // even if the rule was previously `allEnvironments: true`.
    if (allEnvironments !== undefined || environments !== undefined) {
      const { allEnvironments: resolvedAllEnvs, environments: resolvedEnvs } =
        resolveScopeFromInput(
          allEnvironments,
          environments ?? (oldRule.environments as string[] | undefined),
        );
      (updatedRule as FeatureRule).allEnvironments = resolvedAllEnvs;
      (updatedRule as FeatureRule).environments = resolvedEnvs;
    }

    validateRuleConditions({
      condition:
        basePatch.condition !== undefined ? updatedRule.condition : undefined,
      prerequisites:
        basePatch.prerequisites !== undefined ? updatedRule.prerequisites : [],
    });
    // Opt-in registered-attribute check, only on fields the patch actually
    // touches. Validate `changedAttributes` (not `updatedRule`) so an
    // unchanged condition referencing a now-archived attribute doesn't
    // block an unrelated edit. Mirrors the v1 controller's per-field gating.
    const attrPatch = basePatch as {
      condition?: string;
      hashAttribute?: string;
      fallbackAttribute?: string;
    };
    const changedAttributes: Parameters<typeof validateRuleAttributes>[0] = {};
    if (attrPatch.condition !== undefined)
      changedAttributes.condition = attrPatch.condition;
    if (attrPatch.hashAttribute !== undefined)
      changedAttributes.hashAttribute = attrPatch.hashAttribute;
    if (attrPatch.fallbackAttribute !== undefined)
      changedAttributes.fallbackAttribute = attrPatch.fallbackAttribute;
    if (Object.keys(changedAttributes).length > 0) {
      validateRuleAttributes(changedAttributes, req.context, feature.project);
    }
    if (
      basePatch.condition !== undefined ||
      basePatch.savedGroups !== undefined ||
      basePatch.prerequisites !== undefined
    ) {
      await validateRuleReferences(
        {
          condition:
            basePatch.condition !== undefined
              ? updatedRule.condition
              : undefined,
          savedGroups:
            basePatch.savedGroups !== undefined ? updatedRule.savedGroups : [],
          prerequisites:
            basePatch.prerequisites !== undefined
              ? updatedRule.prerequisites
              : [],
        },
        req.context,
      );
    }

    // Fold updated rule back into flat array at the same index.
    const newRules = flatRules.map((r, i) => (i === idx ? updatedRule : r));
    const changes: RevisionChanges = { rules: newRules };

    const usesLegacyScheduling =
      oldRule.type === "experiment-ref" || oldRule.type === "safe-rollout";

    if (usesLegacyScheduling && inlineRampSchedule) {
      throw new BadRequestError(
        `rampSchedule is not supported for ${oldRule.type} rules. Use "schedule" instead.`,
      );
    }

    let resolvedRampAction:
      | ReturnType<typeof normalizeInlineRampSchedule>
      | undefined;
    if (inlineRampSchedule) {
      resolvedRampAction = normalizeInlineRampSchedule(
        inlineRampSchedule,
        updatedRule.id,
      );
      updatedRule.scheduleRules = [];
      updatedRule.scheduleType = "none";
    }
    if (!resolvedRampAction && (schedule?.startDate || schedule?.endDate)) {
      if (usesLegacyScheduling) {
        updatedRule.scheduleRules = [
          { enabled: true, timestamp: schedule.startDate ?? null },
          { enabled: false, timestamp: schedule.endDate ?? null },
        ];
        updatedRule.scheduleType = "schedule";
      } else {
        if (schedule.startDate) updatedRule.enabled = false;
        updatedRule.scheduleRules = [];
        updatedRule.scheduleType = "none";
        resolvedRampAction = buildScheduleRampAction(
          updatedRule.id,
          schedule.startDate,
          schedule.endDate,
        );
      }
    }

    if (resolvedRampAction) {
      const existing = revision.rampActions ?? [];
      const filtered = existing.filter(
        (a) =>
          !("ruleId" in a) ||
          a.ruleId !== (resolvedRampAction as RevisionRampCreateAction).ruleId,
      );
      const nextRampActions = [...filtered];
      const existingLiveSchedule = liveSchedulesForRule[0];
      if (existingLiveSchedule) {
        nextRampActions.push({
          ...(resolvedRampAction as RevisionRampCreateAction),
          mode: "update",
          rampScheduleId: existingLiveSchedule.id,
        } as RevisionRampUpdateAction);
      } else {
        nextRampActions.push(resolvedRampAction);
      }
      changes.rampActions = nextRampActions;
    }

    // Affected envs for review reset.
    const ruleEnvs = updatedRule.allEnvironments
      ? Object.keys(feature.environmentSettings ?? {})
      : (updatedRule.environments ?? []);

    await updateRevision(
      req.context,
      feature,
      revision,
      changes,
      {
        user: req.context.auditUser,
        action: "edit rule",
        subject: req.params.ruleId,
        value: JSON.stringify(updatedRule),
      },
      resetReviewOnChange({
        feature,
        changedEnvironments: ruleEnvs,
        defaultValueChanged: false,
        settings: req.organization.settings,
      }),
    );

    const updated = await getRevision({
      context: req.context,
      organization: req.organization.id,
      featureId: feature.id,
      feature,
      version: revision.version,
    });
    const finalRevision = updated ?? revision;

    await recordRevisionUpdate(
      req.context,
      feature,
      finalRevision,
      "rule.update",
      {
        environments: ruleEnvs,
        auditDetails: { ruleId: req.params.ruleId },
      },
    );

    return { revision: toApiRevisionV2(finalRevision) };
  } catch (err) {
    await discardIfJustCreated(req.context, revision, created);
    throw err;
  }
});
