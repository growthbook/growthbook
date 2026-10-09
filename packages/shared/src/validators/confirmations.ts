import { z } from "zod";
import { baseSchema } from "./base-model";

// `model.action`, model-first like webhook events. `override.*` labels are the
// checks a request skips, whatever it changes.
export const CONFIRM_LABELS = [
  "feature.publish",
  "feature.archive",
  "feature.delete",
  "feature.other",
  "experiment.start",
  "experiment.stop",
  "experiment.targeting",
  "experiment.traffic",
  "experiment.phases",
  "experiment.other",
  "savedGroup.publish",
  "savedGroup.archive",
  "savedGroup.delete",
  "savedGroup.other",
  "constant.publish",
  "constant.archive",
  "constant.delete",
  "constant.other",
  "config.publish",
  "config.archive",
  "config.delete",
  "config.other",
  "rampSchedule.start",
  "rampSchedule.pause",
  "rampSchedule.progression",
  "rampSchedule.approve",
  "rampSchedule.edit",
  "rampSchedule.delete",
  "rampSchedule.other",
  "override.ignoreWarnings",
  "override.skipSchemaValidation",
  "override.skipHooks",
  "override.bypassApproval",
  "override.restBypassesReviews",
  "override.draftLimit",
] as const;
export type ConfirmLabel = (typeof CONFIRM_LABELS)[number];

// Request fields (body or query) that ask to skip a check. Asking is enough to
// hold, whatever the request changes.
export const CONFIRM_OVERRIDE_FLAGS = {
  ignoreWarnings: "override.ignoreWarnings",
  skipSchemaValidation: "override.skipSchemaValidation",
  skipHooks: "override.skipHooks",
  bypassApproval: "override.bypassApproval",
  overrideDraftLimit: "override.draftLimit",
} as const satisfies Record<string, ConfirmLabel>;
type ModelOf<L> = L extends `${infer M}.other` ? M : never;
export type ConfirmModel = ModelOf<ConfirmLabel>;

// Writes to these API tags change live state unless declared otherwise. A write
// that declares no labels holds as `<model>.other`, so "*" and "<model>.*" rules
// cover endpoints added after them.
export const CONFIRM_MODEL_BY_TAG = {
  features: "feature",
  "features-v2": "feature",
  "feature-revisions": "feature",
  "feature-revisions-v2": "feature",
  releases: "feature",
  experiments: "experiment",
  "visual-changesets": "experiment",
  ContextualBandits: "experiment",
  Holdouts: "experiment",
  namespaces: "experiment",
  "saved-groups": "savedGroup",
  "saved-group-revisions": "savedGroup",
  constants: "constant",
  "constant-revisions": "constant",
  configs: "config",
  "config-revisions": "config",
  "ramp-schedules": "rampSchedule",
} as const satisfies Record<string, ConfirmModel>;

// `actions` holds labels, whole categories ("override.*") or everything ("*");
// omitted environments mean every environment.
export const confirmRuleValidator = z.strictObject({
  actions: z.array(z.string()).min(1),
  environments: z.array(z.string()).optional(),
});
export const confirmRulesValidator = z.array(confirmRuleValidator);
export type ConfirmRule = z.infer<typeof confirmRuleValidator>;

export const confirmActionValidator = z.strictObject({
  action: z.enum(CONFIRM_LABELS),
  environments: z.array(z.string()),
});
export type ConfirmAction = z.infer<typeof confirmActionValidator>;

export const confirmationStatuses = [
  "pending",
  "running",
  "completed",
  "rejected",
  "expired",
] as const;
export type ConfirmationStatus = (typeof confirmationStatuses)[number];

// A page the person can check before deciding.
export const confirmationLinkValidator = z.strictObject({
  type: z.enum(["feature", "experiment", "savedGroup", "constant", "config"]),
  label: z.string(),
  url: z.string(),
});
export type ConfirmationLink = z.infer<typeof confirmationLinkValidator>;

export const confirmationValidator = baseSchema.safeExtend({
  // Null when an org key names no one: any member allowed to do the action decides.
  userId: z.string().nullable(),
  apiKeyId: z.string(),
  project: z.string(),
  method: z.string(),
  path: z.string(),
  query: z.record(z.string(), z.unknown()),
  body: z.unknown(),
  requestHash: z.string(),
  actions: z.array(confirmActionValidator),
  summary: z.string(),
  links: z.array(confirmationLinkValidator),
  fingerprint: z.string(),
  status: z.enum(confirmationStatuses),
  response: z
    .strictObject({ status: z.number(), body: z.unknown() })
    .nullable(),
  rejectionNote: z.string().nullable(),
  decidedBy: z.string().nullable(),
  decidedAt: z.date().nullable(),
  expiresAt: z.date(),
  deleteAt: z.date(),
});
export type ConfirmationInterface = z.infer<typeof confirmationValidator>;

export const apiConfirmationValidator = z.strictObject({
  id: z.string(),
  status: z.enum(confirmationStatuses),
  actions: z.array(confirmActionValidator),
  summary: z.string(),
  url: z.string(),
  expiresAt: z.string(),
  response: z
    .strictObject({ status: z.number(), body: z.unknown() })
    .nullable(),
  rejectionNote: z.string().nullable(),
});
export type ApiConfirmation = z.infer<typeof apiConfirmationValidator>;

export const getConfirmationValidator = {
  method: "get" as const,
  path: "/confirmations/:id",
  operationId: "getConfirmation",
  summary: "Get a confirmation",
  description:
    "Poll a held request until a person confirms or rejects it in GrowthBook. Pass `wait` (seconds, max 30) to hold the request open until the status changes.",
  tags: ["meta"],
  paramsSchema: z.strictObject({ id: z.string() }),
  querySchema: z.strictObject({ wait: z.coerce.number().optional() }),
  bodySchema: z.never(),
  responseSchema: z.strictObject({ confirmation: apiConfirmationValidator }),
};
