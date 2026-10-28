import { z } from "zod";
import { baseSchema } from "./base-model";
import { eventUserRequestedBy } from "./event-user";
import { bypassViaValues } from "./shared";
import { namedSchema } from "./openapi-helpers";

// `model.action`, model-first like webhook events. `override.*` actions are the
// checks a request skips, whatever it changes. `draft` is a change that doesn't
// reach users yet; `review` approves or rejects one. `experiment.visualEditor`
// edits what a visual experiment's variations show; `experiment.checklist`
// marks manual launch checklist items complete.
export const CONFIRM_ACTIONS = [
  "feature.create",
  "feature.draft",
  "feature.review",
  "feature.publish",
  "feature.archive",
  "feature.delete",
  "feature.other",
  "experiment.create",
  "experiment.draft",
  "experiment.start",
  "experiment.stop",
  "experiment.targeting",
  "experiment.traffic",
  "experiment.phases",
  "experiment.visualEditor",
  "experiment.checklist",
  "experiment.other",
  "savedGroup.create",
  "savedGroup.draft",
  "savedGroup.review",
  "savedGroup.publish",
  "savedGroup.archive",
  "savedGroup.delete",
  "savedGroup.other",
  "constant.create",
  "constant.draft",
  "constant.review",
  "constant.publish",
  "constant.archive",
  "constant.delete",
  "constant.other",
  "config.create",
  "config.draft",
  "config.review",
  "config.publish",
  "config.archive",
  "config.delete",
  "config.other",
  "rampSchedule.create",
  "rampSchedule.start",
  "rampSchedule.pause",
  "rampSchedule.progression",
  "rampSchedule.approve",
  "rampSchedule.edit",
  "rampSchedule.delete",
  "rampSchedule.other",
  "settings.approvals",
  "settings.other",
  "access.members",
  "access.teams",
  "customHook.create",
  "customHook.edit",
  "customHook.delete",
  "environment.create",
  "environment.edit",
  "environment.delete",
  "project.create",
  "project.edit",
  "project.delete",
  "attribute.create",
  "attribute.edit",
  "attribute.delete",
  "customField.create",
  "customField.edit",
  "customField.delete",
  "sdkConnection.create",
  "sdkConnection.edit",
  "sdkConnection.delete",
  "metric.create",
  "metric.edit",
  "metric.delete",
  "factTable.create",
  "factTable.edit",
  "factTable.delete",
  "segment.create",
  "segment.edit",
  "segment.delete",
  "dimension.create",
  "dimension.edit",
  "dimension.delete",
  "override.ignoreWarnings",
  "override.skipSchemaValidation",
  "override.skipHooks",
  "override.bypassApproval",
  "override.restBypassesReviews",
  "override.draftLimit",
  "override.skipChecklist",
  "override.bypassDuplicateKeyCheck",
  "override.unscopedRules",
  "other.write",
] as const;
export type ConfirmAction = (typeof CONFIRM_ACTIONS)[number];

// The "recommended" rule: everything but creating things, drafting, visual
// editor changes (made with a person at the editor), ticking manual checklist
// items (generated ones still gate a start), and writes with no model of their
// own.
export const RECOMMENDED_CONFIRM_ACTIONS: readonly ConfirmAction[] =
  CONFIRM_ACTIONS.filter(
    (action) =>
      !action.endsWith(".create") &&
      !action.endsWith(".draft") &&
      action !== "experiment.visualEditor" &&
      action !== "experiment.checklist" &&
      action !== "other.write",
  );

// Request fields (body or query) that ask to skip a check. Asking is enough to
// hold, whatever the request changes.
export const CONFIRM_OVERRIDE_FLAGS = {
  ignoreWarnings: "override.ignoreWarnings",
  skipSchemaValidation: "override.skipSchemaValidation",
  skipHooks: "override.skipHooks",
  bypassApproval: "override.bypassApproval",
  overrideDraftLimit: "override.draftLimit",
  skipChecklist: "override.skipChecklist",
  bypassDuplicateKeyCheck: "override.bypassDuplicateKeyCheck",
  allowUnscopedRules: "override.unscopedRules",
} as const satisfies Record<string, ConfirmAction>;

// The override a bypassed check counts as; null when no override covers it.
export const BYPASS_OVERRIDE_ACTIONS: Record<
  (typeof bypassViaValues)[number],
  ConfirmAction | null
> = {
  ignoreWarnings: "override.ignoreWarnings",
  skipSchemaValidation: "override.skipSchemaValidation",
  skipHooks: "override.skipHooks",
  bypassApprovalPermission: "override.bypassApproval",
  restApiBypassesReviews: "override.restBypassesReviews",
  revertsBypassApproval: null,
  skipChecklist: "override.skipChecklist",
};

// The checks a publishing write can ask to skip.
export const PUBLISH_OVERRIDE_ACTIONS = [
  "override.ignoreWarnings",
  "override.skipSchemaValidation",
  "override.skipHooks",
  "override.bypassApproval",
  "override.restBypassesReviews",
] as const satisfies readonly ConfirmAction[];

// What landing a Feature Flag draft can do: publish it, archive the flag, and
// start or edit the ramps it plans.
export const FEATURE_LANDING_ACTIONS = [
  "feature.publish",
  "feature.archive",
  "rampSchedule.start",
  "rampSchedule.edit",
] as const satisfies readonly ConfirmAction[];

type ModelOf<L> = L extends `${infer M}.other` ? M : never;
type ConfirmModel = ModelOf<ConfirmAction>;

// Writes to these API tags change live state unless declared otherwise. A write
// that declares no actions holds as `<model>.other`, so "*" and "<model>.*" rules
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

// What a rule can name: everything ("*"), the recommended set, a whole category
// ("override.*"), or one action.
const RULE_ACTIONS = new Set<string>([
  "*",
  "recommended",
  ...CONFIRM_ACTIONS.map((action) => `${action.split(".")[0]}.*`),
  ...CONFIRM_ACTIONS,
]);

// Omitted environments mean every environment.
export const confirmRuleValidator = z.strictObject({
  actions: z
    .array(
      z.string().refine((action) => RULE_ACTIONS.has(action), {
        message: "Unknown confirmation action",
      }),
    )
    .min(1),
  environments: z.array(z.string()).optional(),
});
export const confirmRulesValidator = z.array(confirmRuleValidator);
export type ConfirmRule = z.infer<typeof confirmRuleValidator>;

export const heldActionValidator = z.strictObject({
  action: z.enum(CONFIRM_ACTIONS),
  environments: z.array(z.string()),
});
export type HeldAction = z.infer<typeof heldActionValidator>;

export const confirmationStatuses = [
  "pending",
  "running",
  "completed",
  "rejected",
  "expired",
] as const;

const confirmationResponseValidator = z
  .strictObject({ status: z.number(), body: z.unknown() })
  .nullable();

// A page the person can check before deciding.
export const confirmationLinkValidator = z.strictObject({
  type: z.enum([
    "feature",
    "experiment",
    "contextualBandit",
    "savedGroup",
    "constant",
    "config",
    "environment",
    "attribute",
    "project",
    "customHook",
    "customField",
    "team",
    "sdkConnection",
    "metric",
    "factMetric",
    "metricGroup",
    "factTable",
    "segment",
    "dimension",
  ]),
  label: z.string(),
  url: z.string(),
});
export type ConfirmationLink = z.infer<typeof confirmationLinkValidator>;

// Server text worth weighing before deciding: a check the request skips, in
// its own words, or what the agent's last try at the same request returned.
export const confirmationNoticeValidator = z.strictObject({
  severity: z.enum(["error", "warning"]),
  messages: z.array(z.string()).min(1),
  // How the request gets past it: a flag it sent, or a policy its caller's
  // authority bypasses. Null for text from a refused attempt.
  via: z.enum(bypassViaValues).nullable(),
});
export type ConfirmationNotice = z.infer<typeof confirmationNoticeValidator>;

export const confirmationValidator = baseSchema.safeExtend({
  // Who confirms: the token's owner, or the member an org key assumes. Null
  // when the key acts as itself: any member allowed to do the action decides.
  userId: z.string().nullable(),
  // The member an org key named with X-GrowthBook-Requested-By.
  requestedBy: eventUserRequestedBy.nullable(),
  assumedRole: z.boolean(),
  apiKeyId: z.string(),
  // The OAuth app whose sign-in sent it. Its tokens last an hour, so a confirm
  // replays the request as whichever token the grant holds by then.
  oauthClientId: z.string().optional(),
  project: z.string(),
  method: z.string(),
  path: z.string(),
  query: z.record(z.string(), z.unknown()),
  body: z.unknown(),
  requestHash: z.string(),
  // What the key's rules matched, shown as why it was held.
  actions: z.array(heldActionValidator),
  // Everything the request does: a decider must be allowed all of it.
  summary: z.string(),
  links: z.array(confirmationLinkValidator),
  notices: z.array(confirmationNoticeValidator),
  // Set when the notices come from the agent's last refused attempt rather
  // than checks run for this request.
  lastAttemptAt: z.date().nullable(),
  fingerprint: z.string(),
  status: z.enum(confirmationStatuses),
  response: confirmationResponseValidator,
  // Left by the person who decided, for the agent.
  note: z.string().nullable(),
  decidedBy: z.string().nullable(),
  decidedAt: z.date().nullable(),
  expiresAt: z.date(),
  deleteAt: z.date(),
});
export type ConfirmationInterface = z.infer<typeof confirmationValidator>;

// A write refused for a key with confirmation on, kept briefly so a retry that
// skips the failed checks can show what they said.
export const confirmationAttemptValidator = baseSchema.safeExtend({
  apiKeyId: z.string(),
  requestHash: z.string(),
  notices: z.array(confirmationNoticeValidator),
  deleteAt: z.date(),
});

export const apiConfirmationValidator = namedSchema(
  "Confirmation",
  z.strictObject({
    id: z.string(),
    status: z.enum(confirmationStatuses),
    actions: z.array(heldActionValidator),
    summary: z.string(),
    url: z.string(),
    expiresAt: z.string(),
    response: confirmationResponseValidator,
    note: z.string().nullable(),
  }),
);
export type ApiConfirmation = z.infer<typeof apiConfirmationValidator>;

// What a held write returns with its 202.
export const apiConfirmationHeldValidator = namedSchema(
  "ConfirmationHeld",
  z.strictObject({
    confirmation: apiConfirmationValidator,
    message: z.string(),
  }),
);

export const getConfirmationValidator = {
  method: "get" as const,
  path: "/confirmations/:id",
  operationId: "getConfirmation",
  summary: "Get a confirmation",
  description:
    "Poll a held request until a person confirms or rejects it in GrowthBook. Pass `wait` (seconds, max 30) to hold the request open until the status changes.",
  tags: ["meta"],
  paramsSchema: z.strictObject({ id: z.string() }),
  querySchema: z.strictObject({
    wait: z.coerce
      .number()
      .int()
      .min(0)
      .max(30)
      .optional()
      .describe("Seconds to wait for a decision before responding, up to 30"),
  }),
  bodySchema: z.never(),
  responseSchema: z.strictObject({ confirmation: apiConfirmationValidator }),
};
