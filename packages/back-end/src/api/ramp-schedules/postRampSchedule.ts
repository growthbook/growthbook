import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import {
  rampControlledField,
  rampStep,
  RampScheduleInterface,
  RampScheduleTemplateInterface,
  RampStepAction,
} from "shared/validators";
import type { FeatureInterface } from "shared/types/feature";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";

const startTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("immediately") }),
  z.object({ type: z.literal("manual") }),
  z.object({ type: z.literal("scheduled"), at: z.string().datetime() }),
]);

const postRampScheduleValidator = {
  bodySchema: z.object({
    name: z.string(),
    // The feature and rule this schedule controls.
    // The rule must already be live (published) before creating a schedule via REST.
    featureId: z.string(),
    ruleId: z.string(),
    environment: z.string(),
    steps: z.array(rampStep).min(0).optional(),
    controlledFields: z
      .array(rampControlledField.exclude(["enabled"]))
      .optional(),
    startCondition: z.object({ trigger: startTriggerSchema }).optional(),
    disableRuleBefore: z.boolean().optional(),
    disableRuleAfter: z.boolean().optional(),
    endCondition: z
      .object({
        trigger: z
          .object({ type: z.literal("scheduled"), at: z.string().datetime() })
          .optional(),
        endEarlyWhenStepsComplete: z.boolean().optional(),
      })
      .optional(),
    // Optional: load and apply a template as defaults; explicit body fields take precedence.
    templateId: z.string().optional(),
  }),
};

/**
 * Returns true if the JSON type of `value` matches the feature's `valueType`.
 * Used to filter `force` values from templates that are incompatible.
 */
function forceMatchesValueType(
  value: unknown,
  valueType: FeatureInterface["valueType"],
): boolean {
  if (value === null || value === undefined) return false;
  const t = typeof value;
  if (valueType === "boolean") return t === "boolean";
  if (valueType === "number") return t === "number";
  if (valueType === "string") return t === "string";
  if (valueType === "json") return t === "object";
  return false;
}

/**
 * Remaps template step actions to use the real targetId and ruleId,
 * and strips `force` values that don't match the feature's valueType.
 */
function remapTemplateActions(
  actions: RampScheduleTemplateInterface["steps"][number]["actions"],
  targetId: string,
  ruleId: string,
  valueType: FeatureInterface["valueType"],
): RampStepAction[] {
  return (actions ?? []).map((a) => {
    const patch = { ...a.patch, ruleId };
    if ("force" in patch && !forceMatchesValueType(patch.force, valueType)) {
      const { force: _force, ...rest } = patch;
      return { targetType: "feature-rule" as const, targetId, patch: rest };
    }
    return { targetType: "feature-rule" as const, targetId, patch };
  });
}

export const postRampSchedule = createApiRequestHandler(
  postRampScheduleValidator,
)(async (req) => {
  const body = req.body;

  // Verify the feature exists and the rule is live
  const feature = await getFeature(req.context, body.featureId);
  if (!feature) {
    throw new Error(`Feature '${body.featureId}' not found`);
  }
  const envRules = feature.environmentSettings?.[body.environment]?.rules ?? [];
  const rule = envRules.find((r) => r.id === body.ruleId);
  if (!rule) {
    throw new Error(
      `Rule '${body.ruleId}' not found in environment '${body.environment}'. ` +
        `The rule must be published before creating a ramp schedule via the REST API.`,
    );
  }

  // Enforce 1:1 — fail if a schedule already targets this rule in this environment
  const existing = await req.context.models.rampSchedules.getAllByFeatureId(
    body.featureId,
  );
  const alreadyAttached = existing.find((s) =>
    s.targets.some(
      (t) => t.ruleId === body.ruleId && t.environment === body.environment,
    ),
  );
  if (alreadyAttached) {
    throw new Error(
      `A ramp schedule (${alreadyAttached.id}) already exists for rule '${body.ruleId}' ` +
        `in environment '${body.environment}'. Delete it first before creating a new one.`,
    );
  }

  // Optionally load a template to use as defaults
  let template: RampScheduleTemplateInterface | undefined;
  if (body.templateId) {
    const tmpl = await req.context.models.rampScheduleTemplates.getById(
      body.templateId,
    );
    if (!tmpl) {
      throw new Error(`Template '${body.templateId}' not found`);
    }
    template = tmpl;
  }

  const targetId = uuidv4();
  const enabledPatch = { ruleId: body.ruleId, enabled: true as const };
  const disabledPatch = { ruleId: body.ruleId, enabled: false as const };

  // Merge template defaults with explicit body fields (body takes precedence)
  const resolvedDisableBefore =
    body.disableRuleBefore ?? template?.disableRuleBefore;
  const resolvedDisableAfter =
    body.disableRuleAfter ?? template?.disableRuleAfter;

  const rawStartTrigger =
    body.startCondition?.trigger ?? template?.startCondition?.trigger;
  const startTrigger =
    rawStartTrigger?.type === "scheduled"
      ? {
          type: "scheduled" as const,
          at: new Date(rawStartTrigger.at as string | Date),
        }
      : (rawStartTrigger ?? { type: "immediately" as const });

  const resolvedSteps = body.steps
    ? body.steps
    : (template?.steps ?? []).map((s) => ({
        ...s,
        actions: remapTemplateActions(
          s.actions,
          targetId,
          body.ruleId,
          feature.valueType,
        ),
      }));

  const resolvedControlledFields = body.controlledFields ?? [];

  // Template start condition actions (may include force values needing filtering)
  const templateStartActions = template?.startCondition?.actions
    ? remapTemplateActions(
        template.startCondition.actions,
        targetId,
        body.ruleId,
        feature.valueType,
      )
    : undefined;

  const startActions = resolvedDisableBefore
    ? [{ targetType: "feature-rule" as const, targetId, patch: enabledPatch }]
    : templateStartActions?.length
      ? templateStartActions
      : undefined;

  const endActions = resolvedDisableAfter
    ? [{ targetType: "feature-rule" as const, targetId, patch: disabledPatch }]
    : undefined;

  // Resolve end condition from body or template
  const rawEndTrigger =
    body.endCondition?.trigger ??
    (template?.endCondition?.trigger?.type === "scheduled"
      ? template.endCondition.trigger
      : undefined);
  const endTrigger = rawEndTrigger
    ? {
        type: "scheduled" as const,
        at: new Date((rawEndTrigger as { type: string; at: string | Date }).at),
      }
    : undefined;

  const resolvedEndEarlyWhenStepsComplete =
    body.endCondition?.endEarlyWhenStepsComplete ??
    template?.endCondition?.endEarlyWhenStepsComplete;

  // Template end condition actions
  const templateEndActions = template?.endCondition?.actions
    ? remapTemplateActions(
        template.endCondition.actions,
        targetId,
        body.ruleId,
        feature.valueType,
      )
    : undefined;

  const mergedEndActions = endActions ?? templateEndActions;

  const endConditionBase =
    endTrigger || mergedEndActions?.length
      ? { trigger: endTrigger, actions: mergedEndActions }
      : undefined;
  const endCondition = endConditionBase
    ? {
        ...endConditionBase,
        endEarlyWhenStepsComplete: resolvedEndEarlyWhenStepsComplete,
      }
    : resolvedEndEarlyWhenStepsComplete !== undefined
      ? { endEarlyWhenStepsComplete: resolvedEndEarlyWhenStepsComplete }
      : undefined;

  const schedule = await req.context.models.rampSchedules.create({
    name: body.name,
    entityType: "feature",
    entityId: body.featureId,
    targets: [
      {
        id: targetId,
        entityType: "feature",
        entityId: body.featureId,
        ruleId: body.ruleId,
        environment: body.environment,
        status: "active",
        controlledFields: resolvedControlledFields,
      },
    ],
    steps: resolvedSteps,
    startCondition: { trigger: startTrigger, actions: startActions },
    disableRuleBefore: resolvedDisableBefore,
    disableRuleAfter: resolvedDisableAfter,
    endCondition,
    // Rule is already published — schedule is immediately eligible to start
    status: "ready",
    currentStepIndex: -1,
    nextStepAt: null,
    nextProcessAt: startTrigger.type === "scheduled" ? startTrigger.at : null,
  } as Omit<
    RampScheduleInterface,
    "id" | "organization" | "dateCreated" | "dateUpdated"
  >);

  return { rampSchedule: schedule };
});
