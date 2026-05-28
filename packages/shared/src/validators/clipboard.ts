import { z } from "zod";
import { featureRule, featureValueType, JSONSchemaDef } from "./features";

// Subset of SafeRolloutInterface that ports cleanly across orgs. Runtime
// state (startedAt, snapshot timestamps, analysisSummary, pastNotifications,
// rampUpSchedule step/completion timestamps) is intentionally excluded —
// the destination starts fresh. Destination-specific refs (datasourceId,
// exposureQueryId, guardrailMetricIds) are carried as-is and are likely to
// be broken in the destination; the user fixes them post-import on the
// auto-created safe rollout.
export const clipboardSafeRolloutSettings = z
  .object({
    datasourceId: z.string(),
    exposureQueryId: z.string(),
    guardrailMetricIds: z.array(z.string()),
    maxDuration: z.object({
      amount: z.number(),
      unit: z.enum(["weeks", "days", "hours", "minutes"]),
    }),
    autoRollback: z.boolean(),
    autoSnapshots: z.boolean(),
    rampUpSchedule: z
      .object({
        enabled: z.boolean(),
        steps: z.array(z.object({ percent: z.number() }).loose()),
      })
      .loose()
      .optional(),
  })
  .loose();
export type ClipboardSafeRolloutSettings = z.infer<
  typeof clipboardSafeRolloutSettings
>;

const clipboardJSONSchemaDef = JSONSchemaDef.extend({
  date: z.preprocess(
    (value) => (typeof value === "string" ? new Date(value) : value),
    z.date(),
  ),
});

// JSON.stringify turns Date fields on `featureRule` (currently
// `banditStageDateStarted`) into ISO strings, which `z.date()` rejects on
// safeParse. Coerce any known date fields back to Date instances before the
// rule union validator runs.
const RULE_DATE_FIELDS = ["banditStageDateStarted"] as const;

// Each rule variant in `featureRule` is `.strict()`, but real-world feature
// rules in the DB often carry stale fields left over from earlier rule types
// (e.g. a rule was a `rollout` with `coverage`, then switched to `force` —
// the form drops `coverage` from the active UI but the value persists on
// disk). Strict validation would reject those rules and silently drop the
// entire paste. Rebuild the union with `.loose()` so unknown top-level
// fields are kept, matching the back-end's accept-what-we-got posture for
// imports.
const lenientFeatureRule = z.union(
  featureRule.options.map((member) => member.loose()),
);

export const clipboardFeatureRule = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const obj = value as Record<string, unknown>;
  let next: Record<string, unknown> | null = null;
  for (const field of RULE_DATE_FIELDS) {
    const current = obj[field];
    if (typeof current === "string") {
      next = next ?? { ...obj };
      next[field] = new Date(current);
    }
  }
  return next ?? value;
}, lenientFeatureRule);

// All clipboard schemas use `.loose()` rather than `.strict()` so that
// a payload exported from a newer GrowthBook instance (with extra fields we
// don't yet know about) still parses successfully. Field-level validation
// will catch structural incompatibilities; unknown fields are ignored rather
// than causing the entire paste to silently fail.
export const growthbookClipboardMetadata = z
  .object({
    source: z.literal("growthbook"),
    object: z.literal("feature"),
    // Accept any positive integer version. Field-level validation below will
    // catch any structural incompatibility from a future envelope rather than
    // silently rejecting the entire paste with no feedback.
    version: z.number().int().min(1),
    exportedAt: z.string().optional(),
  })
  .loose();

// Source-org context for a single reference (experiment, saved group, etc.).
// `name` (and `details` when present) are shown in the import-time reference
// mapping UI so a user can identify what the original referred to.
export const growthbookClipboardReferenceContext = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    details: z.string().optional(),
  })
  .loose();

export type GrowthBookClipboardReferenceContext = z.infer<
  typeof growthbookClipboardReferenceContext
>;

export const growthbookFeatureClipboardReferences = z
  .object({
    experiments: z.array(growthbookClipboardReferenceContext),
    savedGroups: z.array(growthbookClipboardReferenceContext),
    safeRollouts: z.array(growthbookClipboardReferenceContext),
    features: z.array(growthbookClipboardReferenceContext),
    environments: z.array(growthbookClipboardReferenceContext),
  })
  .loose();

export type GrowthBookFeatureClipboardReferences = z.infer<
  typeof growthbookFeatureClipboardReferences
>;

export const growthbookClipboardFeature = z
  .object({
    id: z.string(),
    description: z.string().optional(),
    project: z.string().optional(),
    valueType: z.enum(featureValueType),
    defaultValue: z.string(),
    tags: z.array(z.string()).optional(),
    // environmentSettings is intentionally not part of the clipboard: the
    // importer regenerates env settings from the destination org (see
    // FeatureModal's `genEnvironmentSettings`), so any value carried here
    // would be silently discarded downstream.
    rules: z.array(clipboardFeatureRule),
    customFields: z.record(z.string(), z.any()).optional(),
    jsonSchema: clipboardJSONSchemaDef.optional(),
    neverStale: z.boolean().optional(),
  })
  .loose();

export const growthbookClipboardFeaturePayload = z
  .object({
    growthbook: growthbookClipboardMetadata,
    feature: growthbookClipboardFeature,
    references: growthbookFeatureClipboardReferences,
    // Source-org safe-rollout settings, keyed by the source safeRolloutId
    // referenced from the rules. The importer creates a fresh SafeRollout
    // per safe-rollout rule in the destination using these settings and
    // rewrites rule.safeRolloutId accordingly; mapping by the user isn't
    // required because safe rollouts are per-feature and cross-mapping
    // would be incoherent. Optional for backward compat with older
    // payloads (rules will fail import without it).
    safeRolloutSettings: z
      .record(z.string(), clipboardSafeRolloutSettings)
      .optional(),
  })
  .loose();

// Single-member union today; modeled this way so additional clipboard object
// types (e.g. experiments) can be added as new union members without
// reshaping callers.
export const growthbookClipboardPayload = z.union([
  growthbookClipboardFeaturePayload,
]);

export type GrowthBookClipboardFeature = z.infer<
  typeof growthbookClipboardFeature
>;

export type GrowthBookClipboardPayload = z.infer<
  typeof growthbookClipboardPayload
>;
