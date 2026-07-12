import { z } from "zod";
import { NotificationEventName } from "shared/types/events/base-types";
import { zodNotificationEventNamesEnum } from "./events";

export const eventWebHookPayloadTypes = [
  "raw",
  "json",
  "slack",
  "discord",
] as const;

export type EventWebHookPayloadType = (typeof eventWebHookPayloadTypes)[number];

export const eventWebHookMethods = ["POST", "PUT", "PATCH"] as const;

export type EventWebHookMethod = (typeof eventWebHookMethods)[number];

export const slackEventWebHookMetadata = z
  .object({
    appId: z.string().optional(),
    teamId: z.string().optional(),
    teamName: z.string().optional(),
    enterpriseId: z.string().optional(),
    enterpriseName: z.string().optional(),
    channelName: z.string().optional(),
    channelId: z.string().optional(),
    configurationUrl: z.string().url().optional(),
    botUserId: z.string().optional(),
    authedUserId: z.string().optional(),
    scope: z.string().optional(),
    isEnterpriseInstall: z.boolean().optional(),
  })
  .strict();

// User-facing Slack bot options (the "simple list of options"). Flat keys in
// one object so adding a toggle later only touches this schema.
export const experimentCardFormats = ["none", "compact", "detailed"] as const;

// Digest cadence. `custom` is the same delivery as the other frequencies but
// signals the UI to expose the full day/time editor. `monthly`/`quarterly` are
// selectable now but their delivery job lands in a follow-up.
export const slackDigestFrequencies = [
  "off",
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "custom",
] as const;
export type SlackDigestFrequency = (typeof slackDigestFrequencies)[number];

// Frequencies whose delivery job is wired up today (in addition to "off",
// which is always available). The UI marks the rest — monthly, quarterly,
// custom — all deliver now. (Kept as a set so the UI can flag any future
// not-yet-wired cadence without shipping a dead option.)
export const SLACK_DIGEST_LIVE_FREQUENCIES = new Set<SlackDigestFrequency>([
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "custom",
]);

export const DEFAULT_SLACK_DIGEST_HOUR_UTC = 14; // ~9am ET
export const DEFAULT_SLACK_DIGEST_INTERVAL_DAYS = 14;

// Unified digest config — supersedes the split weekly* / dailyDigestHourUtc
// fields. `dayOfWeekUtc` applies to weekly, `dayOfMonth` to monthly/quarterly,
// `intervalDays` to custom ("every N days").
export const slackDigestConfig = z
  .object({
    frequency: z.enum(slackDigestFrequencies),
    hourUtc: z.number().int().min(0).max(23).optional(),
    dayOfWeekUtc: z.number().int().min(0).max(6).optional(), // 0=Sun
    dayOfMonth: z.number().int().min(1).max(28).optional(),
    intervalDays: z.number().int().min(1).max(90).optional(),
  })
  .strict();
export type SlackDigestConfig = z.infer<typeof slackDigestConfig>;

export const slackEventWebHookOptions = z
  .object({
    // Which results card (if any) to attach to per-event notifications.
    experimentCardFormat: z.enum(experimentCardFormats).optional(),
    // Unified digest schedule. Preferred over the legacy fields below.
    digest: slackDigestConfig.optional(),
    // ---- Legacy digest fields (pre-unification; still read for back-compat
    // on installs saved before the `digest` object existed). ----
    weeklyDigestEnabled: z.boolean().optional(),
    weeklyDigestDayOfWeekUtc: z.number().int().min(0).max(6).optional(), // 0=Sun
    weeklyDigestHourUtc: z.number().int().min(0).max(23).optional(),
    // Legacy: with wildcard event subscriptions, only important events are
    // announced unless this is on. Explicit (curated) subscriptions ignore it.
    showFullChangeLog: z.boolean().optional(),
  })
  .strict();
export type SlackEventWebHookOptions = z.infer<typeof slackEventWebHookOptions>;

export interface ResolvedSlackDigest {
  frequency: SlackDigestFrequency;
  hourUtc: number;
  dayOfWeekUtc: number; // weekly (0=Sun)
  dayOfMonth: number; // monthly / quarterly
  intervalDays: number; // custom ("every N days")
}

// Collapse the new `digest` object and the legacy weekly*/dailyDigestHourUtc
// fields into one effective schedule. The new object wins; otherwise we map
// the old fields (weeklyDigestEnabled → weekly, dailyDigestHourUtc → daily).
export const resolveSlackDigest = (
  options: SlackEventWebHookOptions | undefined,
  legacy?: { dailyDigestHourUtc?: number | null },
): ResolvedSlackDigest => {
  const d = options?.digest;
  if (d) {
    return {
      frequency: d.frequency,
      hourUtc: d.hourUtc ?? DEFAULT_SLACK_DIGEST_HOUR_UTC,
      dayOfWeekUtc: d.dayOfWeekUtc ?? 1,
      dayOfMonth: d.dayOfMonth ?? 1,
      intervalDays: d.intervalDays ?? DEFAULT_SLACK_DIGEST_INTERVAL_DAYS,
    };
  }
  if (options?.weeklyDigestEnabled) {
    return {
      frequency: "weekly",
      hourUtc: options.weeklyDigestHourUtc ?? DEFAULT_SLACK_DIGEST_HOUR_UTC,
      dayOfWeekUtc: options.weeklyDigestDayOfWeekUtc ?? 1,
      dayOfMonth: 1,
      intervalDays: DEFAULT_SLACK_DIGEST_INTERVAL_DAYS,
    };
  }
  if ((legacy?.dailyDigestHourUtc ?? null) !== null) {
    return {
      frequency: "daily",
      hourUtc: legacy?.dailyDigestHourUtc as number,
      dayOfWeekUtc: 1,
      dayOfMonth: 1,
      intervalDays: DEFAULT_SLACK_DIGEST_INTERVAL_DAYS,
    };
  }
  return {
    frequency: "off",
    hourUtc: DEFAULT_SLACK_DIGEST_HOUR_UTC,
    dayOfWeekUtc: 1,
    dayOfMonth: 1,
    intervalDays: DEFAULT_SLACK_DIGEST_INTERVAL_DAYS,
  };
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Quarters begin in these UTC months (Jan, Apr, Jul, Oct).
const QUARTER_START_MONTHS = new Set([0, 3, 6, 9]);

// Whether a resolved digest should fire at `now` (the digest jobs run hourly,
// so we match on the hour plus the frequency's day rule):
//   daily     — every day
//   weekly    — on dayOfWeekUtc
//   monthly   — on dayOfMonth
//   quarterly — on dayOfMonth in a quarter-start month
//   custom    — every intervalDays, anchored to the Unix epoch (deterministic)
export const isSlackDigestDue = (
  r: ResolvedSlackDigest,
  now: Date,
): boolean => {
  if (!SLACK_DIGEST_LIVE_FREQUENCIES.has(r.frequency)) return false;
  if (now.getUTCHours() !== r.hourUtc) return false;
  switch (r.frequency) {
    case "daily":
      return true;
    case "weekly":
      return now.getUTCDay() === r.dayOfWeekUtc;
    case "monthly":
      return now.getUTCDate() === r.dayOfMonth;
    case "quarterly":
      return (
        now.getUTCDate() === r.dayOfMonth &&
        QUARTER_START_MONTHS.has(now.getUTCMonth())
      );
    case "custom": {
      const dayIndex = Math.floor(now.getTime() / MS_PER_DAY);
      return dayIndex % Math.max(1, r.intervalDays) === 0;
    }
    default:
      return false;
  }
};

// The trailing aggregation window (in ms) a scorecard digest should cover for a
// given frequency. Daily uses its own text-summary job, so this covers the
// scorecard cadences (weekly and longer).
export const slackDigestWindowMs = (r: ResolvedSlackDigest): number => {
  switch (r.frequency) {
    case "weekly":
      return 7 * MS_PER_DAY;
    case "monthly":
      return 30 * MS_PER_DAY;
    case "quarterly":
      return 91 * MS_PER_DAY;
    case "custom":
      return Math.max(1, r.intervalDays) * MS_PER_DAY;
    default:
      return 7 * MS_PER_DAY;
  }
};

// Low-signal experiment events suppressed from live delivery by default (unless
// the channel opts into the full change log). They still land in the
// daily/weekly digest (which reads events directly). Everything else —
// started, significance, decisions, stopped, SRM/guardrail warnings — is
// always announced.
export const LOW_SIGNAL_EXPERIMENT_EVENTS = new Set<string>([
  "experiment.updated",
  "experiment.status.changed",
  "experiment.endingSoon",
  "experiment.stale",
  "experiment.health.noData",
  "experiment.health.queryFailed",
  "experiment.bandit.weightsChanged",
]);

export const isLowSignalExperimentEvent = (eventName: string): boolean =>
  LOW_SIGNAL_EXPERIMENT_EVENTS.has(eventName);

// Matches multi-level wildcard patterns like "feature.*", "feature.revision.*",
// or "savedGroup.revision.*" (resource names may be camelCase).
export const EVENT_WEBHOOK_WILDCARD_PATTERN = /^[a-zA-Z]+(\.[a-zA-Z]+)*\.\*$/;

export const isEventWebhookWildcard = (val: string) =>
  EVENT_WEBHOOK_WILDCARD_PATTERN.test(val);

// A concrete event name or a wildcard subscription pattern (e.g. "feature.*").
// Widens to string; runtime validation is enforced by the Zod schema.
export type NotificationEventNameOrWildcard = NotificationEventName | string;

// Returns all wildcard patterns that could match an event name.
// e.g. "feature.revision.discarded" → ["feature.*", "feature.revision.*"]
export const getWildcardPatternsForEvent = (eventName: string): string[] => {
  const parts = eventName.split(".");
  const wildcards: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    wildcards.push(`${parts.slice(0, i).join(".")}.*`);
  }
  return wildcards;
};

// ---------------------------------------------------------------------------
// Slack event catalog — the user-facing simplification of the raw event names.
//
// The Slack settings UI presents these grouped options (not the ~54 raw event
// names). Each option maps to one or more concrete events; toggling it on/off
// adds/removes those events from the webhook's `events` array, which is the
// single source of truth for what gets delivered live. `defaultOn` options
// make up the curated default subscription for a fresh install and the
// "on" state of the simple per-category toggle.
// ---------------------------------------------------------------------------

export type SlackEventCategory = "experiment" | "feature";

export interface SlackEventOption {
  // Stable id for React keys and selection state.
  id: string;
  label: string;
  description?: string;
  category: SlackEventCategory;
  // Group heading within the advanced section.
  group: string;
  // Concrete event names this option controls (all must be subscribed for the
  // option to read as "on").
  events: string[];
  // Part of the curated default subscription / simple-toggle preset.
  defaultOn: boolean;
}

export const SLACK_EVENT_OPTIONS: SlackEventOption[] = [
  // ---- Experiment · Lifecycle ----
  {
    id: "exp-started",
    label: "Experiment started",
    category: "experiment",
    group: "Lifecycle",
    events: ["experiment.started"],
    defaultOn: true,
  },
  {
    id: "exp-stopped",
    label: "Experiment stopped",
    description: "Stopped and shipped, or stopped and rolled back.",
    category: "experiment",
    group: "Lifecycle",
    events: ["experiment.stopped.shipped", "experiment.stopped.rolledback"],
    defaultOn: true,
  },
  {
    id: "exp-created",
    label: "New experiment (draft)",
    description: "When an experiment is first created, before it starts.",
    category: "experiment",
    group: "Lifecycle",
    events: ["experiment.created"],
    defaultOn: false,
  },
  {
    id: "exp-updated",
    label: "Experiment edited",
    description: "Metadata, targeting, or variation changes.",
    category: "experiment",
    group: "Lifecycle",
    events: ["experiment.updated"],
    defaultOn: false,
  },
  {
    id: "exp-status-changed",
    label: "Status changed",
    category: "experiment",
    group: "Lifecycle",
    events: ["experiment.status.changed"],
    defaultOn: false,
  },
  {
    id: "exp-deleted",
    label: "Experiment deleted",
    category: "experiment",
    group: "Lifecycle",
    events: ["experiment.deleted"],
    defaultOn: false,
  },
  {
    id: "exp-ending-soon",
    label: "Ending soon",
    category: "experiment",
    group: "Lifecycle",
    events: ["experiment.endingSoon"],
    defaultOn: false,
  },
  {
    id: "exp-stale",
    label: "Stale (no decision)",
    category: "experiment",
    group: "Lifecycle",
    events: ["experiment.stale"],
    defaultOn: false,
  },
  // ---- Experiment · Results & decisions ----
  {
    id: "exp-significance",
    label: "Reached significance",
    category: "experiment",
    group: "Results & decisions",
    events: ["experiment.info.significance"],
    defaultOn: true,
  },
  {
    id: "exp-decision",
    label: "Decision ready",
    description: "Ready to ship, roll back, or review.",
    category: "experiment",
    group: "Results & decisions",
    events: [
      "experiment.decision.ship",
      "experiment.decision.rollback",
      "experiment.decision.review",
    ],
    defaultOn: true,
  },
  {
    id: "exp-metric-regression",
    label: "Metric regression",
    category: "experiment",
    group: "Results & decisions",
    events: ["experiment.metric.regression"],
    defaultOn: true,
  },
  // ---- Experiment · Health & warnings ----
  {
    id: "exp-warning",
    label: "Warnings",
    description: "SRM, multiple exposures, and other warning conditions.",
    category: "experiment",
    group: "Health & warnings",
    events: ["experiment.warning"],
    defaultOn: true,
  },
  {
    id: "exp-guardrail-failed",
    label: "Guardrail failed",
    category: "experiment",
    group: "Health & warnings",
    events: ["experiment.health.guardrailFailed"],
    defaultOn: true,
  },
  {
    id: "exp-no-data",
    label: "No data",
    category: "experiment",
    group: "Health & warnings",
    events: ["experiment.health.noData"],
    defaultOn: false,
  },
  {
    id: "exp-query-failed",
    label: "Query failed",
    category: "experiment",
    group: "Health & warnings",
    events: ["experiment.health.queryFailed"],
    defaultOn: false,
  },
  // ---- Experiment · Advanced ----
  {
    id: "exp-bandit",
    label: "Bandit weights changed",
    category: "experiment",
    group: "Advanced",
    events: ["experiment.bandit.weightsChanged"],
    defaultOn: false,
  },
  {
    id: "exp-holdout",
    label: "Holdout created / updated",
    category: "experiment",
    group: "Advanced",
    events: ["experiment.holdout.created", "experiment.holdout.updated"],
    defaultOn: false,
  },
  // ---- Feature · Changes ----
  {
    id: "feat-published",
    label: "New version published",
    description: "A draft revision is published live.",
    category: "feature",
    group: "Feature changes",
    events: ["feature.revision.published"],
    defaultOn: true,
  },
  {
    id: "feat-reverted",
    label: "Reverted to previous version",
    category: "feature",
    group: "Feature changes",
    events: ["feature.revision.reverted"],
    defaultOn: true,
  },
  {
    id: "feat-created",
    label: "Feature created",
    category: "feature",
    group: "Feature changes",
    events: ["feature.created"],
    defaultOn: false,
  },
  {
    id: "feat-updated",
    label: "Feature updated",
    category: "feature",
    group: "Feature changes",
    events: ["feature.updated"],
    defaultOn: false,
  },
  {
    id: "feat-deleted",
    label: "Feature deleted",
    category: "feature",
    group: "Feature changes",
    events: ["feature.deleted"],
    defaultOn: false,
  },
  // ---- Feature · Safe rollouts ----
  {
    id: "feat-saferollout",
    label: "Safe rollout outcomes",
    description: "Ready to ship, should roll back, or unhealthy.",
    category: "feature",
    group: "Safe rollouts",
    events: [
      "feature.saferollout.ship",
      "feature.saferollout.rollback",
      "feature.saferollout.unhealthy",
    ],
    defaultOn: true,
  },
  // ---- Feature · Drafts & review ----
  {
    id: "feat-revision-created",
    label: "New draft revision",
    category: "feature",
    group: "Drafts & review",
    events: ["feature.revision.created"],
    defaultOn: false,
  },
  {
    id: "feat-revision-updated",
    label: "Draft edited",
    category: "feature",
    group: "Drafts & review",
    events: ["feature.revision.updated"],
    defaultOn: false,
  },
  {
    id: "feat-review-requested",
    label: "Review requested",
    category: "feature",
    group: "Drafts & review",
    events: ["feature.revision.reviewRequested"],
    defaultOn: true,
  },
  {
    id: "feat-review-approved",
    label: "Draft approved",
    category: "feature",
    group: "Drafts & review",
    events: ["feature.revision.approved"],
    defaultOn: false,
  },
  {
    id: "feat-changes-requested",
    label: "Changes requested",
    category: "feature",
    group: "Drafts & review",
    events: ["feature.revision.changesRequested"],
    defaultOn: true,
  },
  {
    id: "feat-revision-commented",
    label: "Comment on draft",
    category: "feature",
    group: "Drafts & review",
    events: ["feature.revision.commented"],
    defaultOn: false,
  },
  {
    id: "feat-revision-discarded",
    label: "Draft discarded",
    category: "feature",
    group: "Drafts & review",
    events: ["feature.revision.discarded"],
    defaultOn: false,
  },
  // ---- Feature · Advanced ----
  {
    id: "feat-ramp",
    label: "Ramp schedule activity",
    description: "Ramp schedule created, advanced, completed, or rolled back.",
    category: "feature",
    group: "Advanced",
    events: [
      "feature.rampSchedule.created",
      "feature.rampSchedule.deleted",
      "feature.rampSchedule.actions.started",
      "feature.rampSchedule.actions.completed",
      "feature.rampSchedule.actions.rolledBack",
      "feature.rampSchedule.actions.jumped",
      "feature.rampSchedule.actions.step.advanced",
      "feature.rampSchedule.actions.step.approvalRequired",
    ],
    defaultOn: false,
  },
  {
    id: "feat-stale",
    label: "Stale flag candidate",
    category: "feature",
    group: "Advanced",
    events: ["feature.stale.candidate"],
    defaultOn: false,
  },
];

// Curated default subscription (concrete event names) for a fresh Slack install.
export const defaultSlackEventSubscriptions = (): string[] =>
  SLACK_EVENT_OPTIONS.filter((o) => o.defaultOn).flatMap((o) => o.events);

// All concrete events in a category (used by the simple on/off toggle to
// enable everything, and to detect/strip a category wholesale).
export const slackCategoryEvents = (
  category: SlackEventCategory,
  { onlyDefault = false }: { onlyDefault?: boolean } = {},
): string[] =>
  SLACK_EVENT_OPTIONS.filter(
    (o) => o.category === category && (!onlyDefault || o.defaultOn),
  ).flatMap((o) => o.events);

// True if a webhook subscribes to `eventName` — directly or via a wildcard
// pattern (e.g. "experiment.*" covers "experiment.started").
export const isSlackEventSubscribed = (
  subscriptions: string[],
  eventName: string,
): boolean =>
  subscriptions.includes(eventName) ||
  getWildcardPatternsForEvent(eventName).some((w) => subscriptions.includes(w));

// The catalog option ids that read as "on" for a given subscription array.
export const selectedSlackOptionIds = (subscriptions: string[]): Set<string> =>
  new Set(
    SLACK_EVENT_OPTIONS.filter((o) =>
      o.events.every((e) => isSlackEventSubscribed(subscriptions, e)),
    ).map((o) => o.id),
  );

// The catalog option ids that are on by default (the recommended set).
export const defaultSlackOptionIds = (): Set<string> =>
  new Set(SLACK_EVENT_OPTIONS.filter((o) => o.defaultOn).map((o) => o.id));

// True if a subscription deviates in either direction from the recommended
// defaults (opted into extras, or removed some) — i.e. the user has customized
// the event list. Used to flag customized installs in the overview.
//
// A legacy wildcard install ("feature.*" etc.) is treated as unconfigured, not
// customized: its wildcard matches every event, which isn't a deliberate
// choice. It reads as the recommended baseline until saved as an explicit list.
export const isSlackSubscriptionCustomized = (
  subscriptions: string[],
): boolean => {
  if (hasWildcardSubscription(subscriptions)) return false;
  const selected = selectedSlackOptionIds(subscriptions);
  const defaults = defaultSlackOptionIds();
  if (selected.size !== defaults.size) return true;
  for (const id of defaults) if (!selected.has(id)) return true;
  return false;
};

// True if the webhook still uses wildcard subscriptions (a legacy install that
// predates the curated per-event UI). Such installs keep the low-signal
// suppression gate; explicit subscriptions do not.
export const hasWildcardSubscription = (subscriptions: string[]): boolean =>
  subscriptions.some((s) => isEventWebhookWildcard(s));

const eventNameOrWildcard = z
  .string()
  .refine(
    (val: string) =>
      zodNotificationEventNamesEnum.includes(val as never) ||
      isEventWebhookWildcard(val),
    {
      message: `Must be a valid event name or wildcard pattern (e.g., "feature.*", "feature.revision.*")`,
    },
  );

// Coalescing window: when > 0, deliveries for chat-style payload types
// (slack, discord) buffer events keyed by the touched object for this many
// milliseconds, then send a single digest message. 0/undefined disables
// (events deliver one-to-one as before).
export const EVENT_WEBHOOK_DEFAULT_COALESCE_WINDOW_MS = 15_000;
export const EVENT_WEBHOOK_MAX_COALESCE_WINDOW_MS = 5 * 60_000;

export const eventWebHookInterface = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    url: z.string().url(),
    name: z.string().trim().min(2),
    events: z.array(eventNameOrWildcard).min(1),
    enabled: z.boolean(),
    projects: z.array(z.string()),
    tags: z.array(z.string()),
    environments: z.array(z.string()),
    experiments: z.array(z.string()),
    metrics: z.array(z.string()),
    payloadType: z.enum(eventWebHookPayloadTypes),
    method: z.enum(eventWebHookMethods),
    headers: z.record(z.string(), z.string()),
    slack: slackEventWebHookMetadata.optional(),
    signingKey: z.string().min(2),
    lastRunAt: z.union([z.date(), z.null()]),
    lastState: z.enum(["none", "success", "error"]),
    lastResponseBody: z.union([z.string(), z.null()]),
    coalesceWindowMs: z
      .number()
      .int()
      .min(0)
      .max(EVENT_WEBHOOK_MAX_COALESCE_WINDOW_MS)
      .optional(),
    dailyDigestHourUtc: z.number().int().min(0).max(23).optional(),
    // Slack bot display/digest options. A single object (flat keys) so new
    // toggles are just a new key here — no model/router/controller surgery.
    slackOptions: slackEventWebHookOptions.optional(),
  })
  .strict();

export type EventWebHookInterface = z.infer<typeof eventWebHookInterface>;
