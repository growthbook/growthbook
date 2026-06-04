import { z } from "zod";
import {
  apiPaginationFieldsValidator,
  apiRampScheduleInterface,
  experimentHealthAction,
  featureRulePatch,
  paginationQueryFields,
  rampMonitoringConfig,
  stepHoldConditions,
} from "shared/validators";
import { OpenApiModelSpec } from "back-end/src/api/ApiModel";

// --- Create body schemas ---

const postBodyPatch = featureRulePatch
  .partial({ ruleId: true })
  .extend({
    ruleId: z
      .string()
      .optional()
      .describe("Auto-injected when ruleId is provided at the top level"),
  })
  .describe(
    "Sparse patch — only fields present are applied; absent fields accumulate from previous steps",
  );

const postBodyAction = z.object({
  targetType: z
    .literal("feature-rule")
    .optional()
    .describe("Omit when using featureId+ruleId+environment (auto-injected)"),
  targetId: z
    .string()
    .optional()
    .describe("Auto-injected when featureId+ruleId+environment are provided"),
  patch: postBodyPatch,
});

const postBodyStep = z.object({
  interval: z
    .number()
    .positive()
    .nullable()
    .describe(
      "Hold duration in seconds before this step's gates are evaluated. null = no time gate (advance as soon as holdConditions clear). Pure approval steps use `{ interval: null, holdConditions: { requiresApproval: true } }`.",
    ),
  actions: z.array(postBodyAction).optional(),
  approvalNotes: z.string().nullish(),
  monitored: z
    .boolean()
    .default(false)
    .describe(
      "When true, this step runs A/B traffic analysis while active. Enrolled users are split 50/50 between control and variation, so a coverage of 1.0 means 50% of users see the variation. The SDK uses hash-based filters on the experiment rule to prevent bucketing shifts when transitioning between monitored and unmonitored steps.",
    ),
  holdConditions: stepHoldConditions.optional(),
});

const createBodySchema = z
  .object({
    name: z.string(),
    featureId: z
      .string()
      .optional()
      .describe(
        "Feature that anchors this schedule. Required when `ruleId` is set.",
      ),
    ruleId: z
      .string()
      .optional()
      .describe(
        "Rule to attach as the initial target. Requires `featureId`. Post-v2 `rule.id` is uniquely sufficient; `environment` is optional and deprecated.",
      ),
    environment: z
      .string()
      .optional()
      .meta({ deprecated: true })
      .describe(
        "Deprecated. Legacy disambiguator for pre-v2 rules whose `ruleId` could repeat across envs. Omit on new schedules — the resolver uses `rule.id` directly.",
      ),
    steps: z
      .array(postBodyStep)
      .optional()
      .describe(
        "Ordered ramp steps. When `featureId`+`ruleId` are provided,\n`targetId` and `patch.ruleId` in actions are auto-injected — only\nsupply the patch fields you want to change.\n",
      ),
    startActions: z
      .array(postBodyAction)
      .optional()
      .describe(
        "Actions that restore controlled rules to their pre-ramp state. When omitted for an attached rule, the server captures the current published rule state.",
      ),
    endActions: z
      .array(postBodyAction)
      .optional()
      .describe(
        "Actions applied when the ramp completes. `targetId` and `patch.ruleId` are auto-injected when `featureId`+`ruleId` are provided.",
      ),
    startDate: z
      .string()
      .datetime()
      .optional()
      .nullable()
      .describe("When to start. Absent/null = immediately on start action."),
    cutoffDate: z
      .string()
      .datetime()
      .optional()
      .nullable()
      .describe(
        "Rule-level kill date. When reached, the ramp completes and the rule is disabled. Use for time-boxed rules. Set to null to clear.",
      ),
    lockdownConfig: z
      .object({
        mode: z.enum(["none", "locked"]),
      })
      .optional()
      .describe(
        "When mode is 'locked', blocks all feature edits while the ramp is actively running (not after completion or between end and cutoff).",
      ),
    monitoringConfig: rampMonitoringConfig.nullish(),
    experimentHealthAction: experimentHealthAction.optional(),
    templateId: z
      .string()
      .optional()
      .describe(
        "Load steps and endActions from a saved template (featureId+ruleId must also be set for auto-injection)",
      ),
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
    // `environment` is no longer required alongside `ruleId`. Post-v2
    // `rule.id` is uniquely sufficient; env is an optional legacy
    // disambiguator. See `rampTarget` in shared/validators.
  });

// --- Update body schemas ---

// API update body action — relaxed version of patch-rule for partial updates
const putBodyAction = z.object({
  targetType: z.literal("feature-rule").optional(),
  targetId: z.string().optional(),
  patch: featureRulePatch.optional(),
});

const putBodyStep = z.object({
  interval: z
    .number()
    .positive()
    .nullable()
    .describe(
      "Hold duration in seconds before this step's gates are evaluated. null = no time gate (advance as soon as holdConditions clear).",
    ),
  actions: z.array(putBodyAction).optional(),
  approvalNotes: z.string().nullish(),
  monitored: z
    .boolean()
    .default(false)
    .describe(
      "When true, this step runs A/B traffic analysis while active. Enrolled users are split 50/50 between control and variation, so a coverage of 1.0 means 50% of users see the variation. The SDK uses hash-based filters on the experiment rule to prevent bucketing shifts when transitioning between monitored and unmonitored steps.",
    ),
  holdConditions: stepHoldConditions.optional(),
});

const updateBodySchema = z.object({
  name: z.string().optional(),
  steps: z.array(putBodyStep).optional(),
  startActions: z.array(putBodyAction).optional(),
  endActions: z.array(putBodyAction).optional(),
  startDate: z.string().datetime().optional().nullable(),
  cutoffDate: z.string().datetime().optional().nullable(),
  monitoringConfig: rampMonitoringConfig.nullish(),
  experimentHealthAction: experimentHealthAction.optional(),
  lockdownConfig: z
    .object({ mode: z.enum(["none", "locked"]) })
    .optional()
    .describe(
      "When mode is 'locked', blocks all feature edits while the ramp is actively running.",
    ),
});

// --- List query schema override ---

const listQuerySchema = z.object({
  ...paginationQueryFields,
  featureId: z.string().optional(),
  status: z
    .enum(["pending", "ready", "running", "paused", "completed", "rolled-back"])
    .optional()
    .describe("Filter by schedule status"),
});

// --- Spec ---

export const rampScheduleApiSpec = {
  modelSingular: "rampSchedule",
  modelPlural: "rampSchedules",
  pathBase: "/ramp-schedules",
  apiInterface: apiRampScheduleInterface,
  schemas: {
    createBody: createBodySchema,
    updateBody: updateBodySchema,
  },
  includeDefaultCrud: false,
  crudActions: ["get", "list", "delete", "update"] as const,
  crudValidatorOverrides: {
    list: {
      querySchema: listQuerySchema,
      responseSchema: apiPaginationFieldsValidator.safeExtend({
        rampSchedules: z.array(apiRampScheduleInterface),
      }),
    },
  },
  crudDescriptions: {
    list: "Returns all ramp schedules for the organization, with optional filters.\n",
    create:
      "Creates a new ramp schedule, optionally attaching it to a published feature rule.\n\n### Target attachment (optional)\n\nProvide `featureId` and `ruleId` together to attach the schedule to a specific\nrule on creation. The rule must already be live (published). Each rule can only\nbe controlled by one schedule at a time.\n\nWhen both are supplied, **`targetId` and `patch.ruleId` are auto-injected**\ninto every step action and endAction — callers only need to supply the patch\nvalues (`coverage`, `condition`, etc.).\n\n`environment` is accepted for backward compatibility with pre-v2 ramps but is\ndeprecated and no longer required. Post-v2 `rule.id` is uniquely sufficient.\n\nIf rule attachment is omitted, the schedule is created as a free-standing\nskeleton in `pending` status. Use `POST /ramp-schedules/{id}/actions/add-target`\nto attach rules later, and `POST /ramp-schedules/{id}/actions/start` to start it.\n\n### Coverage on monitored steps\n\nFor monitored steps (`monitored: true`), `coverage` represents total experiment\nenrollment (both control and variation), not the fraction of users seeing\nvariation 1. The experiment splits enrolled traffic 50/50, so variation-1\nexposure is `coverage / 2`. For example, to show variation 1 to 25% of users,\nset `coverage: 0.5`. The SDK payload uses hash-based filters (not coverage) on\nthe experiment rule to prevent bucketing shifts when transitioning between\nmonitored and unmonitored steps.\n\n### Using templates\n\nProvide `templateId` to inherit steps and endActions from a saved template.\nExplicit `steps` / `endActions` in the request body take precedence over the\ntemplate. Template auto-population requires `featureId` and `ruleId` to be set\n(so targetId can be injected).\n\nRequires an **Enterprise** plan.\n",
    update:
      'Updates the name, steps, endActions, startDate, or cutoffDate of a ramp schedule.\n\nOnly allowed when the schedule is in `pending`, `ready`, or `paused` status.\n\n**targetId shorthand**: When providing `steps` or `endActions`, you may omit `targetId`\n(or pass `"t1"`) in each action. If the schedule has exactly one active target, the server\nwill resolve it automatically. For schedules with multiple targets, provide the explicit\ntarget UUID from `targets[].id`.\n\n**Coverage on monitored steps**: See the create endpoint description for details\non how `coverage` is interpreted for monitored steps (total enrollment, not\nvariation-1 exposure).\n',
    delete:
      "Permanently deletes a ramp schedule. This does not undo any rule patches that\nwere already applied by completed steps.\n",
  },
  tag: "ramp-schedules",
  navDisplayName: "Ramp Schedules",
  navDescription:
    "Multi-step rollout schedules with optional real-time monitoring, interval timers, approval gates, and hold conditions.",
} satisfies OpenApiModelSpec;
export default rampScheduleApiSpec;
