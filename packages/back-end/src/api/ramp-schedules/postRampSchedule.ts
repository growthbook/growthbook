import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import {
  apiRampScheduleInterface,
  experimentHealthAction,
  featureRulePatch,
  RampScheduleInterface,
  RampScheduleTemplateInterface,
  RampStepAction,
  stepHoldConditions,
  isAwaitingStartApproval,
} from "shared/validators";
import type { FeatureInterface } from "shared/types/feature";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import { rampScheduleToApiInterface } from "back-end/src/models/RampScheduleModel";
import {
  dispatchRampEvent,
  dispatchAwaitingStartApproval,
  getStartActionsFromRules,
  remapTemplateActions,
} from "back-end/src/services/rampSchedule";
import { resolveRampTargets } from "back-end/src/util/flattenRules";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";

const postBodyAction = z.object({
  targetType: z.literal("feature-rule").optional(),
  targetId: z.string().optional(),
  patch: featureRulePatch.partial({ ruleId: true }),
});
type PostBodyAction = z.infer<typeof postBodyAction>;

function normalizeMonitoringConfig(
  monitoringConfig:
    | RampScheduleInterface["monitoringConfig"]
    | null
    | undefined,
) {
  if (!monitoringConfig) return monitoringConfig ?? null;
  if (!monitoringConfig.monitoringMode) return monitoringConfig;
  return {
    ...monitoringConfig,
    autoUpdate: monitoringConfig.monitoringMode === "auto",
  };
}

// New unified step shape: `interval` is the hold duration in seconds (null
// means no time gate). Pure approval steps use
// `{ interval: null, holdConditions: { requiresApproval: true } }`.
const postBodyStep = z.object({
  interval: z.number().positive().nullable(),
  actions: z.array(postBodyAction).optional().default([]),
  approvalNotes: z.string().nullish(),
  monitored: z.boolean().default(false),
  holdConditions: stepHoldConditions.optional(),
});

const postRampScheduleValidator = {
  method: "post" as const,
  path: "/ramp-schedules",
  operationId: "postRampSchedule",
  summary: "Create a ramp schedule",
  tags: ["ramp-schedules"],
  responseSchema: z.object({ rampSchedule: apiRampScheduleInterface }),
  bodySchema: z
    .object({
      name: z.string().optional(),
      featureId: z.string().optional(),
      ruleId: z.string().optional(),
      environment: z.string().optional(),
      steps: z.array(postBodyStep).optional(),
      startActions: z.array(postBodyAction).optional(),
      endActions: z.array(postBodyAction).optional(),
      startDate: z.string().datetime().optional().nullable(),
      cutoffDate: z.string().datetime().optional().nullable(),
      requiresStartApproval: z
        .boolean()
        .nullish()
        .describe(
          "When true, the ramp holds at step -1 with its rule disabled (zero traffic) until a human approves the start via /actions/approve-step. Composes with startDate.",
        ),
      monitoringConfig: z
        .object({
          datasourceId: z.string(),
          exposureQueryId: z.string(),
          guardrailMetricIds: z.array(z.string()).min(1),
          signalMetricIds: z.array(z.string()).optional(),
          monitoringMode: z.enum(["auto", "manual"]).optional(),
          autoUpdate: z.boolean().optional(),
          autoRollback: z.boolean().optional(),
          updateScheduleMinutes: z.number().min(10).optional().nullable(),
          srmAction: z.enum(["warn", "hold", "rollback"]).optional(),
          noTrafficAction: z.enum(["warn", "hold", "rollback"]).optional(),
          multipleExposureAction: z
            .enum(["warn", "hold", "rollback"])
            .optional(),
        })
        .nullish(),
      lockdownConfig: z.object({ mode: z.enum(["none", "locked"]) }).optional(),
      experimentHealthAction: experimentHealthAction.optional(),
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
      // NOTE: `environment` is no longer required alongside `ruleId`. Post-v2,
      // `rule.id` is uniquely sufficient within a feature's unified rule list;
      // env is a deprecated pre-v2 disambiguator. See `rampTarget` in
      // shared/validators.
      if (data.steps) {
        for (let i = 0; i < data.steps.length; i++) {
          const step = data.steps[i];
          if (!step.monitored) continue;
          for (const action of step.actions) {
            if (action.patch.coverage === 0) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message:
                  "Monitored steps must have coverage greater than 0. There is nothing to monitor at 0% traffic.",
                path: ["steps", i],
              });
            }
          }
        }
      }
    }),
};

function normalizeAction(action: PostBodyAction): RampStepAction {
  return {
    targetType: "feature-rule" as const,
    targetId: action.targetId ?? "",
    patch: action.patch as RampStepAction["patch"],
  };
}

// Overrides targetId/ruleId from the top-level shorthand fields.
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

  // REST uses the Enterprise "ramp-schedules" gate; the dashboard uses the
  // Pro "schedule-feature-flag" gate since simple schedules share the infra.
  if (!req.context.hasPremiumFeature("ramp-schedules")) {
    req.context.throwPlanDoesNotAllowError(
      "Ramp schedules require an Enterprise plan.",
    );
  }

  const hasTarget = !!(body.featureId && body.ruleId);

  let targetId: string | undefined;
  let feature: FeatureInterface | null = null;

  if (body.featureId) {
    feature = await getFeature(req.context, body.featureId);
    if (!feature) {
      throw new NotFoundError(`Feature '${body.featureId}' not found`);
    }
  }

  if (hasTarget) {
    const envSuffix = body.environment
      ? ` in environment '${body.environment}'`
      : "";
    const matches = resolveRampTargets(
      { ruleId: body.ruleId!, environment: body.environment ?? null },
      feature!.rules ?? [],
    );
    const rule = matches[0];
    if (!rule) {
      throw new NotFoundError(
        `Rule '${body.ruleId}' not found${envSuffix}. ` +
          `The rule must be published before attaching a ramp schedule.`,
      );
    }
    if (matches.length > 1 && !body.environment) {
      const siblingEnvs = Array.from(
        new Set(
          matches.flatMap((r) =>
            r.allEnvironments ? ["(all environments)"] : (r.environments ?? []),
          ),
        ),
      ).sort();
      throw new BadRequestError(
        `Rule '${body.ruleId}' is ambiguous — it matches ${matches.length} sibling rules (${siblingEnvs.join(", ")}). ` +
          `Specify an 'environment' to disambiguate.`,
      );
    }

    // "Start on approval" promises zero traffic until approved, but this
    // endpoint can't publish the rule disabled (no feature revision here). If
    // the target rule is already serving, reject rather than silently leave it
    // live while the schedule reports "awaiting approval".
    if (body.requiresStartApproval && rule.enabled) {
      throw new BadRequestError(
        `Rule '${body.ruleId}' is currently enabled${envSuffix}. ` +
          `Disable it before creating a start-approval ramp schedule, or it would keep serving traffic until approved.`,
      );
    }

    const conflicting = await req.context.models.rampSchedules.findByTargetRule(
      body.ruleId!,
      body.environment ?? undefined,
    );
    if (conflicting.length > 0) {
      throw new BadRequestError(
        `A ramp schedule (${conflicting[0].id}) already controls rule '${body.ruleId}'${envSuffix}. ` +
          `Delete it first before creating a new one.`,
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
      throw new NotFoundError(`Template '${body.templateId}' not found`);
    }
    template = tmpl;
  }

  const startDate = body.startDate ? new Date(body.startDate) : undefined;

  // Prefer body steps, fall back to template steps (if target known), else [].
  const resolvedSteps: RampScheduleInterface["steps"] = (() => {
    if (body.steps !== undefined) {
      return body.steps.map((s) => ({
        interval: s.interval,
        actions: s.actions.map((a) =>
          hasTarget
            ? injectTarget(a, targetId!, body.ruleId!)
            : normalizeAction(a),
        ),
        approvalNotes: s.approvalNotes ?? undefined,
        monitored: s.monitored,
        holdConditions: s.holdConditions ?? undefined,
      }));
    }
    if (template && hasTarget) {
      return template.steps.map((s) => ({
        interval: s.interval,
        actions: remapTemplateActions(
          s.actions,
          targetId!,
          body.ruleId!,
          feature!.valueType,
        ),
        approvalNotes: s.approvalNotes ?? undefined,
        monitored: !!s.monitored,
        holdConditions: s.holdConditions ?? undefined,
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
          patch: {
            ruleId: body.ruleId!,
            ...template.endPatch,
          },
        },
      ];
    }
    return undefined;
  })();

  const resolvedStartActions: RampStepAction[] | undefined = (() => {
    if (body.startActions !== undefined) {
      return body.startActions.map((a) =>
        hasTarget
          ? injectTarget(a, targetId!, body.ruleId!)
          : normalizeAction(a),
      );
    }
    if (hasTarget) {
      const actions = getStartActionsFromRules({
        rules: feature!.rules ?? [],
        targetId: targetId!,
        ruleId: body.ruleId!,
        environment: body.environment,
      });
      return actions.length > 0 ? actions : undefined;
    }
    return undefined;
  })();

  const defaultName = `Ramp schedule \u2013 ${new Date().toLocaleDateString(
    "en-US",
    { month: "short", year: "numeric" },
  )}`;

  const schedule = await req.context.models.rampSchedules.create({
    name: body.name ?? defaultName,
    entityType: "feature",
    entityId: body.featureId ?? "",
    targets: hasTarget
      ? [
          {
            id: targetId!,
            entityType: "feature",
            entityId: body.featureId!,
            ruleId: body.ruleId,
            // `environment` is deliberately omitted on new targets. Post-v2
            // `rule.id` is uniquely sufficient within a feature's unified rule
            // list; env is a deprecated pre-v2 disambiguator. The resolver
            // and DB-side lookup still honor stored `environment` for legacy
            // targets. See `rampTarget` in shared/validators.
            status: "active",
          },
        ]
      : [],
    startActions: resolvedStartActions,
    steps: resolvedSteps,
    endActions: resolvedEndActions,
    startDate,
    cutoffDate: body.cutoffDate ? new Date(body.cutoffDate) : null,
    monitoringConfig: normalizeMonitoringConfig(
      body.monitoringConfig ?? template?.monitoringConfig ?? null,
    ),
    lockdownConfig: body.lockdownConfig ?? template?.lockdownConfig,
    ...(body.experimentHealthAction
      ? { experimentHealthAction: body.experimentHealthAction }
      : {}),
    requiresStartApproval: body.requiresStartApproval || undefined,
    status: hasTarget ? "ready" : "pending",
    currentStepIndex: -1,
    nextStepAt: null,
    // An approval-gated schedule must not auto-arm (even with a startDate) — it
    // holds until /actions/approve-step. Leaving nextProcessAt null keeps the
    // poller from picking it up until the approval sets it.
    nextProcessAt: body.requiresStartApproval ? null : (startDate ?? null),
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

  // A schedule created directly into the pre-start hold emits the same
  // awaiting-approval signal as the publish/rollback paths.
  if (isAwaitingStartApproval(schedule)) {
    await dispatchAwaitingStartApproval(req.context, schedule);
  }

  return { rampSchedule: rampScheduleToApiInterface(schedule) };
});
