import { z } from "zod";
import { featurePrerequisite, savedGroupTargeting } from "./shared";
import { apiBaseSchema, baseSchema } from "./base-model";

// Patch applied to a feature rule by a ramp step. Only fields present in the patch are applied;
// absent fields are inherited from the previous step's accumulated state.
export const featureRulePatch = z.object({
  ruleId: z.string(),
  coverage: z.number().min(0).max(1).nullish(),
  condition: z.string().nullish(),
  savedGroups: z.array(savedGroupTargeting).nullish(),
  prerequisites: z.array(featurePrerequisite).nullish(),
  force: z.any().optional(), // any JSON-serializable value
  // internal only — injected by disableRuleBefore / disableRuleAfter
  enabled: z.boolean().nullish(),
});
export type FeatureRulePatch = z.infer<typeof featureRulePatch>;

export const rampStepAction = z.object({
  targetType: z.literal("feature-rule"),
  targetId: z.string(),
  patch: featureRulePatch,
});
export type RampStepAction = z.infer<typeof rampStepAction>;

// Fields a ramp can manage on a feature rule.
export const rampControlledField = z.enum([
  "coverage",
  "condition",
  "savedGroups",
  "prerequisites",
  "force",
  "enabled", // internal only — injected by disableRuleBefore / disableRuleAfter
]);
export type RampControlledField = z.infer<typeof rampControlledField>;

// activatingRevisionVersion: set when ramp is created alongside a rule change; cleared on publish.
export const rampTarget = z.object({
  id: z.string(),
  entityType: z.enum(["feature"]), // TODO v2: add "experiment"
  entityId: z.string(),
  ruleId: z.string().nullish(),
  environment: z.string().nullish(),
  status: z.enum(["pending-join", "active"]),
  activatingRevisionVersion: z.number().int().nullish(),
  controlledFields: z.array(rampControlledField).optional(),
});
export type RampTarget = z.infer<typeof rampTarget>;

// "immediately": auto-start on activating revision publish.
// "manual": transitions to "ready"; requires explicit user start.
// "scheduled": transitions to "ready"; Agenda auto-starts when now >= at.
export const rampStartTrigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("immediately") }),
  z.object({ type: z.literal("manual") }),
  z.object({ type: z.literal("scheduled"), at: z.date() }),
]);
export type RampStartTrigger = z.infer<typeof rampStartTrigger>;

export const rampEndTrigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("scheduled"), at: z.date() }),
]);
export type RampEndTrigger = z.infer<typeof rampEndTrigger>;

export const rampTrigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("interval"), seconds: z.number().positive() }),
  z.object({ type: z.literal("approval") }),
  z.object({ type: z.literal("scheduled"), at: z.date() }),
]);
export type RampTrigger = z.infer<typeof rampTrigger>;

// Sparse patch per step — only fields present are applied; absent fields accumulate from previous steps.
export const rampStep = z.object({
  trigger: rampTrigger,
  actions: z.array(rampStepAction),
  approvalNotes: z.string().nullish(),
});
export type RampStep = z.infer<typeof rampStep>;

export const rampScheduleStatusArray = [
  "pending",
  "ready",
  "running",
  "paused",
  "pending-approval",
  "completed",
  "rolled-back",
] as const;
export type RampScheduleStatus = (typeof rampScheduleStatusArray)[number];

export const rampScheduleValidator = baseSchema
  .extend({
    name: z.string(),
    // Controls permissions and approval settings for the schedule.
    entityType: z.enum(["feature"]), // TODO v2: add "experiment"
    entityId: z.string(),
    targets: z.array(rampTarget),
    steps: z.array(rampStep),
    // Baseline actions applied on start — the fully-qualified initial state; all subsequent steps accumulate from here.
    startCondition: z.object({
      trigger: rampStartTrigger,
      actions: z.array(rampStepAction).nullish(),
    }),
    disableRuleBefore: z.boolean().optional(), // hides rule before start; injects enabled:true
    disableRuleAfter: z.boolean().optional(), // hides rule after end; injects enabled:false
    endCondition: z
      .object({
        trigger: rampEndTrigger.optional(),
        actions: z.array(rampStepAction).nullish(),
        // true = complete when steps finish (ramp-up); false = hold until trigger (scheduled rule)
        endEarlyWhenStepsComplete: z.boolean().optional(),
      })
      .nullish(),
    status: z.enum(rampScheduleStatusArray),
    currentStepIndex: z.number().int().min(-1),
    startedAt: z.date().nullish(),
    phaseStartedAt: z.date().nullish(), // interval timing anchor; resets after approval gates
    pausedAt: z.date().nullish(),
    nextStepAt: z.date().nullable(),
    nextProcessAt: z.date().nullish(), // next time the job should process this schedule; null = no polling needed
    elapsedMs: z.number().int().nullish(), // computed at response time; never stored
  })
  .strict()
  .superRefine((data, ctx) => {
    if (
      data.steps.length === 0 &&
      data.startCondition.trigger.type !== "scheduled" &&
      !data.endCondition?.trigger
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "A ramp schedule with no steps must have a scheduled start trigger or an end condition trigger.",
        path: ["steps"],
      });
    }
  });

export type RampScheduleInterface = z.infer<typeof rampScheduleValidator>;

// Patch fields that are portable across features and can be stored in a template.
// Excludes `force` (feature-type-specific) and `enabled`/`ruleId` (system-injected).
export const TEMPLATE_PATCH_FIELDS = [
  "coverage",
  "condition",
  "savedGroups",
  "prerequisites",
] as const;
export type TemplatePatchField = (typeof TEMPLATE_PATCH_FIELDS)[number];

// Top-level behavioral keys of a template (excludes metadata: id, name, org, dates).
export const TEMPLATE_STRUCTURAL_KEYS = [
  "steps",
  "startCondition",
  "endCondition",
  "disableRuleBefore",
  "disableRuleAfter",
] as const;
export type TemplateStructuralKey = (typeof TEMPLATE_STRUCTURAL_KEYS)[number];

// Template patches never store force — it is feature-type-specific and not portable.
const templateFeatureRulePatch = featureRulePatch.omit({ force: true });
const templateRampStepAction = rampStepAction.extend({
  patch: templateFeatureRulePatch,
});
const templateRampStep = rampStep.extend({
  actions: z.array(templateRampStepAction),
});

// Template: same shape as a ramp schedule, minus stateful and target-specific fields.
export const rampScheduleTemplateValidator = baseSchema
  .extend({
    name: z.string(),
    steps: z.array(templateRampStep),
    startCondition: z.object({
      trigger: rampStartTrigger,
      actions: z.array(templateRampStepAction).nullish(),
    }),
    disableRuleBefore: z.boolean().optional(),
    disableRuleAfter: z.boolean().optional(),
    endCondition: z
      .object({
        trigger: rampEndTrigger.optional(),
        actions: z.array(templateRampStepAction).nullish(),
        endEarlyWhenStepsComplete: z.boolean().optional(),
      })
      .nullish(),
    official: z.boolean().optional(),
  })
  .strict();
export type RampScheduleTemplateInterface = z.infer<
  typeof rampScheduleTemplateValidator
>;

// API-facing variant — uses ISO strings for dates (for OpenApiModelSpec compatibility).
export const apiRampScheduleTemplateValidator = apiBaseSchema
  .extend({
    name: z.string(),
    steps: z.array(z.any()),
    startCondition: z.object({
      trigger: z.any(),
      actions: z.array(z.any()).nullish(),
    }),
    disableRuleBefore: z.boolean().optional(),
    disableRuleAfter: z.boolean().optional(),
    endCondition: z
      .object({
        trigger: z.any().optional(),
        actions: z.array(z.any()).nullish(),
        endEarlyWhenStepsComplete: z.boolean().optional(),
      })
      .nullish(),
    official: z.boolean().optional(),
  })
  .strict();

// Minimal type for pending/draft ramp schedules before full data is available.
export type RampScheduleForDisplay = Partial<RampScheduleInterface> & {
  id: string;
  status: RampScheduleInterface["status"];
  name: string;
  targets: RampScheduleInterface["targets"];
  steps: RampScheduleInterface["steps"];
  startCondition: RampScheduleInterface["startCondition"];
  dateCreated: Date;
  dateUpdated: Date;
};
