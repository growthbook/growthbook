import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import {
  featureRulePatch,
  RampScheduleInterface,
  RampScheduleTemplateInterface,
  RampStepAction,
} from "shared/validators";
import type { FeatureInterface } from "shared/types/feature";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import { dispatchRampEvent } from "back-end/src/services/rampSchedule";

const postBodyAction = z.object({
  targetType: z.literal("feature-rule").optional(),
  targetId: z.string().optional(),
  patch: featureRulePatch.partial({ ruleId: true }),
});
type PostBodyAction = z.infer<typeof postBodyAction>;

const apiRampTrigger = z.union([
  z.object({ type: z.literal("interval"), seconds: z.number().positive() }),
  z.object({ type: z.literal("approval") }),
  z.object({ type: z.literal("scheduled"), at: z.string() }),
]);

const postBodyStep = z.object({
  trigger: apiRampTrigger,
  actions: z.array(postBodyAction).optional().default([]),
  approvalNotes: z.string().nullish(),
});

const postRampScheduleValidator = {
  bodySchema: z
    .object({
      name: z.string(),
      featureId: z.string().optional(),
      ruleId: z.string().optional(),
      environment: z.string().optional(),
      steps: z.array(postBodyStep).optional(),
      endActions: z.array(postBodyAction).optional(),
      startDate: z.string().datetime().optional().nullable(),
      endCondition: z
        .object({
          trigger: z
            .object({ type: z.literal("scheduled"), at: z.string().datetime() })
            .optional(),
        })
        .optional(),
      templateId: z.string().optional(),
    })
    .superRefine((data, ctx) => {
      if (data.ruleId && !data.featureId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["featureId"],
          message: "featureId is required when ruleId is provided",
        });
      }
      if (data.environment && !data.ruleId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ruleId"],
          message: "ruleId is required when environment is provided",
        });
      }
      if (data.ruleId && !data.environment) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["environment"],
          message: "environment is required when ruleId is provided",
        });
      }
    }),
};

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

// Remaps template actions to the real targetId/ruleId; strips incompatible `force` values.
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

function normalizeApiTrigger(
  trigger: z.infer<typeof apiRampTrigger>,
): RampScheduleInterface["steps"][number]["trigger"] {
  if (trigger.type === "scheduled") {
    return { type: "scheduled", at: new Date(trigger.at) };
  }
  if (trigger.type === "interval") {
    return { type: "interval", seconds: trigger.seconds };
  }
  return { type: "approval" };
}

function normalizeAction(action: PostBodyAction): RampStepAction {
  return {
    targetType: "feature-rule" as const,
    targetId: action.targetId ?? "",
    patch: action.patch as RampStepAction["patch"],
  };
}

// Overrides targetId and ruleId from top-level shorthand fields.
function injectTarget(
  action: PostBodyAction,
  targetId: string,
  ruleId: string,
): RampStepAction {
  return {
    targetType: "feature-rule" as const,
    targetId,
    patch: { ...action.patch, ruleId },
  };
}

export const postRampSchedule = createApiRequestHandler(
  postRampScheduleValidator,
)(async (req) => {
  const body = req.body;

  // REST uses Enterprise ("ramp-schedules"); the dashboard uses Pro ("schedule-feature-flag")
  // because simple schedules share infrastructure there.
  if (!req.context.hasPremiumFeature("ramp-schedules")) {
    req.context.throwPlanDoesNotAllowError(
      "Ramp schedules require an Enterprise plan.",
    );
  }

  const hasTarget = !!(body.featureId && body.ruleId && body.environment);

  let targetId: string | undefined;
  let feature: FeatureInterface | null = null;

  if (body.featureId) {
    feature = await getFeature(req.context, body.featureId);
    if (!feature) {
      throw new Error(`Feature '${body.featureId}' not found`);
    }
  }

  if (hasTarget) {
    const envRules =
      feature!.environmentSettings?.[body.environment!]?.rules ?? [];
    const rule = envRules.find((r) => r.id === body.ruleId);
    if (!rule) {
      throw new Error(
        `Rule '${body.ruleId}' not found in environment '${body.environment}'. ` +
          `The rule must be published before attaching a ramp schedule.`,
      );
    }

    const conflicting = await req.context.models.rampSchedules.findByTargetRule(
      body.ruleId!,
      body.environment!,
    );
    if (conflicting.length > 0) {
      throw new Error(
        `A ramp schedule (${conflicting[0].id}) already controls rule '${body.ruleId}' ` +
          `in environment '${body.environment}'. Delete it first before creating a new one.`,
      );
    }

    targetId = uuidv4();
  }

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

  const startDate = body.startDate ? new Date(body.startDate) : undefined;

  // body steps → template steps (when target known) → []
  const resolvedSteps: RampScheduleInterface["steps"] = (() => {
    if (body.steps !== undefined) {
      return body.steps.map((s) => ({
        trigger: normalizeApiTrigger(s.trigger),
        actions: s.actions.map((a) =>
          hasTarget
            ? injectTarget(a, targetId!, body.ruleId!)
            : normalizeAction(a),
        ),
        approvalNotes: s.approvalNotes ?? undefined,
      }));
    }
    if (template && hasTarget) {
      return template.steps.map((s) => ({
        trigger: s.trigger,
        actions: remapTemplateActions(
          s.actions,
          targetId!,
          body.ruleId!,
          feature!.valueType,
        ),
        approvalNotes: s.approvalNotes ?? undefined,
      }));
    }
    return [];
  })();

  const resolvedEndActions: RampStepAction[] | undefined = (() => {
    if (body.endActions !== undefined) {
      return body.endActions.map((a) =>
        hasTarget
          ? injectTarget(a, targetId!, body.ruleId!)
          : normalizeAction(a),
      );
    }
    if (
      template?.endPatch &&
      hasTarget &&
      Object.keys(template.endPatch).length > 0
    ) {
      return [
        {
          targetType: "feature-rule" as const,
          targetId: targetId!,
          patch: { ruleId: body.ruleId!, ...template.endPatch },
        },
      ];
    }
    return undefined;
  })();

  const rawEndTrigger = body.endCondition?.trigger;
  const endTrigger = rawEndTrigger
    ? {
        type: "scheduled" as const,
        at: new Date((rawEndTrigger as { type: string; at: string | Date }).at),
      }
    : undefined;
  const endCondition = endTrigger ? { trigger: endTrigger } : undefined;

  const schedule = await req.context.models.rampSchedules.create({
    name: body.name,
    entityType: "feature",
    entityId: body.featureId ?? "",
    targets: hasTarget
      ? [
          {
            id: targetId!,
            entityType: "feature",
            entityId: body.featureId!,
            ruleId: body.ruleId,
            environment: body.environment,
            status: "active",
          },
        ]
      : [],
    steps: resolvedSteps,
    endActions: resolvedEndActions,
    startDate,
    endCondition,
    status: hasTarget ? "ready" : "pending",
    currentStepIndex: -1,
    nextStepAt: null,
    nextProcessAt: startDate ?? null,
  } as Omit<
    RampScheduleInterface,
    "id" | "organization" | "dateCreated" | "dateUpdated"
  >);

  await dispatchRampEvent(req.context, schedule, "rampSchedule.created", {
    object: {
      rampScheduleId: schedule.id,
      rampName: schedule.name,
      orgId: req.context.org.id,
      entityType: schedule.entityType,
      entityId: schedule.entityId,
    },
  });

  return { rampSchedule: schedule };
});
