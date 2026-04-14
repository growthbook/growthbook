import { z } from "zod";
import {
  apiRampScheduleInterface,
  featureRulePatch,
  rampStepAction,
} from "shared/validators";
import { OpenApiModelSpec } from "back-end/src/api/ApiModel";

// --- Create body schemas ---

const postBodyAction = z.object({
  targetType: z.literal("feature-rule").optional(),
  targetId: z.string().optional(),
  patch: featureRulePatch.partial({ ruleId: true }),
});

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

const createBodySchema = z
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
  });

// --- Update body schemas ---

const putBodyAction = rampStepAction
  .omit({ targetId: true })
  .extend({ targetId: z.string().optional() });

const putBodyStep = z.object({
  trigger: apiRampTrigger,
  actions: z.array(putBodyAction),
  approvalNotes: z.string().nullish(),
});

const updateBodySchema = z.object({
  name: z.string().optional(),
  steps: z.array(putBodyStep).min(0).optional(),
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
  featureId: z.string().optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  offset: z.coerce.number().int().min(0).default(0),
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
    },
  },
  navDisplayName: "Ramp Schedules",
  navDescription:
    "Multi-step rollout schedules that gradually ramp feature rule changes over time.",
} satisfies OpenApiModelSpec;
export default rampScheduleApiSpec;
