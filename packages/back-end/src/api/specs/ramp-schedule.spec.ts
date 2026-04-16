import { z } from "zod";
import {
  apiPaginationFieldsValidator,
  apiRampScheduleInterface,
  featureRulePatch,
  paginationQueryFields,
  rampStepAction,
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

const apiRampTrigger = z.union([
  z.object({ type: z.literal("interval"), seconds: z.number().positive() }),
  z.object({ type: z.literal("approval") }),
  z.object({ type: z.literal("scheduled"), at: z.string() }),
]);

const postBodyStep = z.object({
  trigger: apiRampTrigger,
  actions: z.array(postBodyAction).optional(),
  approvalNotes: z.string().nullish(),
});

const createBodySchema = z
  .object({
    name: z.string(),
    featureId: z
      .string()
      .optional()
      .describe(
        "Feature that anchors this schedule. Required when ruleId/environment are set.",
      ),
    ruleId: z
      .string()
      .optional()
      .describe(
        "Rule to attach as the initial target. Requires featureId and environment.",
      ),
    environment: z
      .string()
      .optional()
      .describe(
        "Environment of the target rule. Requires featureId and ruleId.",
      ),
    steps: z
      .array(postBodyStep)
      .optional()
      .describe(
        "Ordered ramp steps. When featureId+ruleId+environment are provided,\n`targetId` and `patch.ruleId` in actions are auto-injected — only\nsupply the patch fields you want to change.\n",
      ),
    endActions: z
      .array(postBodyAction)
      .optional()
      .describe(
        "Actions applied when the ramp completes. targetId and patch.ruleId are auto-injected when featureId+ruleId+environment are provided.",
      ),
    startDate: z
      .string()
      .datetime()
      .optional()
      .nullable()
      .describe("When to start. Absent/null = immediately on start action."),
    endCondition: z
      .object({
        trigger: z
          .object({ type: z.literal("scheduled"), at: z.string().datetime() })
          .optional(),
      })
      .optional()
      .describe("Optional hard deadline"),
    templateId: z
      .string()
      .optional()
      .describe(
        "Load steps and endActions from a saved template (featureId+ruleId+environment must also be set for auto-injection)",
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
    if (data.ruleId && !data.environment) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["environment"],
        message: "environment is required when ruleId is provided",
      });
    }
  });

// --- Update body schemas ---

const putBodyAction = rampStepAction
  .omit({ targetId: true, targetType: true })
  .extend({
    targetType: z.literal("feature-rule").optional(),
    targetId: z.string().optional(),
  });

const putBodyStep = z.object({
  trigger: apiRampTrigger,
  actions: z.array(putBodyAction).optional(),
  approvalNotes: z.string().nullish(),
});

const updateBodySchema = z.object({
  name: z.string().optional(),
  steps: z.array(putBodyStep).optional(),
  endActions: z.array(putBodyAction).optional(),
  startDate: z.string().datetime().optional().nullable(),
  endCondition: z
    .object({
      trigger: z
        .object({ type: z.literal("scheduled"), at: z.string().datetime() })
        .optional(),
    })
    .optional()
    .nullable(),
});

// --- List query schema override ---

const listQuerySchema = z.object({
  ...paginationQueryFields,
  featureId: z.string().optional(),
  status: z
    .enum([
      "pending",
      "ready",
      "running",
      "paused",
      "pending-approval",
      "completed",
      "rolled-back",
    ])
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
  includeDefaultCrud: true,
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
      "Creates a new ramp schedule, optionally attaching it to a published feature rule.\n\n### Target attachment (optional)\n\nProvide `featureId`, `ruleId`, and `environment` together to attach the schedule\nto a specific rule on creation. The rule must already be live (published). Each\n`[ruleId, environment]` pair can only be controlled by one schedule at a time.\n\nWhen all three are supplied, **`targetId` and `patch.ruleId` are auto-injected**\ninto every step action and endAction — callers only need to supply the patch\nvalues (`coverage`, `condition`, etc.).\n\nIf omitted, the schedule is created as a free-standing skeleton in `pending`\nstatus. Use `POST /ramp-schedules/{id}/actions/add-target` to attach rules later,\nand `POST /ramp-schedules/{id}/actions/start` to start it.\n\n### Using templates\n\nProvide `templateId` to inherit steps and endActions from a saved template.\nExplicit `steps` / `endActions` in the request body take precedence over the\ntemplate. Template auto-population requires `featureId`, `ruleId`, and\n`environment` to be set (so targetId can be injected).\n\nRequires an **Enterprise** plan.\n",
    update:
      'Updates the name, steps, endActions, startDate, or endCondition of a ramp schedule.\n\nOnly allowed when the schedule is in `pending`, `ready`, or `paused` status.\n\n**targetId shorthand**: When providing `steps` or `endActions`, you may omit `targetId`\n(or pass `"t1"`) in each action. If the schedule has exactly one active target, the server\nwill resolve it automatically. For schedules with multiple targets, provide the explicit\ntarget UUID from `targets[].id`.\n',
    delete:
      "Permanently deletes a ramp schedule. This does not undo any rule patches that\nwere already applied by completed steps.\n",
  },
  tag: "ramp-schedules",
  navDisplayName: "Ramp Schedules",
  navDescription:
    "Multi-step rollout schedules that gradually ramp feature rule changes over time.",
} satisfies OpenApiModelSpec;
export default rampScheduleApiSpec;
