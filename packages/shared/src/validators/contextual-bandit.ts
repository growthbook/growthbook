import { z } from "zod";
import { apiBaseSchema, baseSchema } from "./base-model";
import { attributionModel, metricOverride, variation } from "./experiments";
import { priorSettingsValidator } from "./fact-table";
import { namedSchema } from "./openapi-helpers";
import { ownerEmailField, ownerField, ownerInputField } from "./owner-field";

/** Per-leaf arm weights stored on a CB phase. */
export const leafWeightValidator = z.object({
  contextId: z.string(),
  weights: z.array(z.number()),
});
export type LeafWeight = z.infer<typeof leafWeightValidator>;

/**
 * Per-phase weight history for a contextual bandit run.
 *
 * Fields mirror the relevant subset of `experimentPhase` (dateStarted,
 * coverage, condition, seed, variationWeights). Notable omissions:
 *
 * - `name` / `reason`: CB phases are auto-managed; we don't surface a name
 *   in the UI today.
 * - `banditEvents`: CB events live on their own `ContextualBanditEvent`
 *   collection, not on the phase row.
 * - `savedGroups`, `prerequisites`, `namespace`: CB targeting goes through
 *   the SDK rule, not phase-level targeting.
 */
export const cbPhaseValidator = z.object({
  dateStarted: z.date(),
  dateEnded: z.date().nullable().optional(),
  /**
   * Fraction of eligible traffic enrolled into the CB.
   * Defaults to 1.0 (full coverage) — matches the experiment-phase default.
   */
  coverage: z.number().min(0).max(1).optional(),
  /** JSON-string MongoDB-style targeting condition, mirrors experimentPhase. */
  condition: z.string().optional(),
  /** Seed for the hashing function. Optional; defaults to the CB's trackingKey. */
  seed: z.string().optional(),
  /**
   * Current variation weights for this period — analogous to
   * `experimentPhase.variationWeights`. Used by the SDK rule emitter
   * to set arm allocation when a user has no context match.
   */
  variationWeights: z.array(z.number()).optional(),
  /** Per-leaf arm weights for this CB period. */
  currentLeafWeights: z.array(leafWeightValidator),
});
export type CbPhase = z.infer<typeof cbPhaseValidator>;

export const contextualBanditStatus = ["draft", "running", "stopped"] as const;
export type ContextualBanditStatus = (typeof contextualBanditStatus)[number];

export const contextualBanditValidator = baseSchema
  .extend({
    // ---------------------------------------------------------------------
    // Cross-model FK (transitional)
    // ---------------------------------------------------------------------
    /**
     * Foreign key → ExperimentInterface.id. Retained for the duration of the
     * decoupling project so existing CB docs can be backfilled from their
     * parent experiment on read. Dropped in PR-8 once the data migration has
     * landed. New writes should treat the CB doc as the source of truth.
     *
     * @deprecated Will be removed after the CB experiment-decoupling
     * migration. Read CB-native fields directly off this doc instead.
     */
    experiment: z.string().optional(),

    // ---------------------------------------------------------------------
    // Ownership / project / lifecycle metadata
    // (mirrors the relevant subset of `experimentInterface`)
    // ---------------------------------------------------------------------
    /** Display name for the CB. */
    name: z.string(),
    /** Optional free-text description / hypothesis. */
    description: z.string().optional(),
    hypothesis: z.string().optional(),
    /** Project the CB lives in. Empty string ("") = no project. */
    project: z.string().optional(),
    /** User ID (or raw legacy owner) of the CB owner. */
    owner: ownerField,
    tags: z.array(z.string()),
    archived: z.boolean(),
    customFields: z.record(z.string(), z.any()).optional(),

    // ---------------------------------------------------------------------
    // Lifecycle / status
    // ---------------------------------------------------------------------
    status: z.enum(contextualBanditStatus),
    dateStarted: z.date().optional(),
    dateStopped: z.date().optional(),

    // ---------------------------------------------------------------------
    // Assignment / SDK rule
    // ---------------------------------------------------------------------
    trackingKey: z.string(),
    hashAttribute: z.string(),
    fallbackAttribute: z.string().optional(),
    hashVersion: z.union([z.literal(1), z.literal(2)]),
    /**
     * Sticky bucketing is intentionally unsupported in v1 — see the
     * comment on `disableStickyBucketing` for the deeper rationale and
     * its planned interaction with the v1.5 holdout pipeline.
     *
     * Renamed from the original `stickyBucketing: boolean` field. Per the
     * May 2026 product memo, the semantics are inverted so the default
     * (`false`) matches the rest of the platform's hash-rule conventions:
     * `false` means sticky bucketing is enabled when the org has the
     * feature, `true` means it is explicitly disabled for this CB.
     */
    // Default `false` is supplied via `defaultValues` in
    // ContextualBanditModel's MakeModelClass config, per the project's
    // eslint rule banning `.default()` on Zod schemas.
    disableStickyBucketing: z.boolean(),

    /** Ordered variations participating in the bandit. */
    variations: z.array(variation),

    // ---------------------------------------------------------------------
    // Datasource & analysis
    // ---------------------------------------------------------------------
    /**
     * Datasource ID. Aliased to `datasource` (the field name used on the
     * experiment) so the snapshot orchestrator can read either spelling
     * without a translation layer.
     *
     * @deprecated Prefer `datasource` — present here only to align with the
     * older API shape. Both refer to the same datasource.
     */
    datasourceId: z.string(),
    datasource: z.string(),
    exposureQueryId: z.string(),
    segment: z.string().optional(),
    queryFilter: z.string().optional(),
    /** Goal metric IDs evaluated during the CB run. */
    goalMetrics: z.array(z.string()),
    /** Secondary metric IDs (informational only). */
    secondaryMetrics: z.array(z.string()),
    /** Guardrail metric IDs — bandits read these alongside the decision metric. */
    guardrailMetrics: z.array(z.string()),
    /** Activation metric, optional, must precede goal metrics. */
    activationMetric: z.string().optional(),
    metricOverrides: z.array(metricOverride).optional(),
    defaultMetricPriorSettings: priorSettingsValidator,
    attributionModel: z.enum(attributionModel).optional(),
    skipPartialData: z.boolean().optional(),
    regressionAdjustmentEnabled: z.boolean().optional(),

    // ---------------------------------------------------------------------
    // Phases — CB-specific (no banditEvents on the phase)
    // ---------------------------------------------------------------------
    phases: z.array(cbPhaseValidator),

    // ---------------------------------------------------------------------
    // CB-specific configuration
    // ---------------------------------------------------------------------
    /**
     * Ordered list of attribute column names used to derive context IDs.
     *
     * Aliased as `targetingAttributeColumns` (the spelling used on the
     * snapshot-settings DTO and the exposure-query record) so the SQL
     * builders don't have to translate. Both fields hold the same value.
     */
    contextualAttributes: z.array(z.string()),
    targetingAttributeColumns: z.array(z.string()).optional(),

    /** The metric whose performance drives arm reweighting. */
    decisionMetric: z.string().optional(),

    /** Maximum number of distinct contexts to track. */
    maxContexts: z.number().int().positive(),

    /** Decision-tree algorithm/model name (e.g. "linear_tree"). */
    treeModel: z.string(),

    /** Minimum users required in a leaf for that leaf to be split. */
    minUsersPerLeaf: z.number().int().positive(),

    /** Maximum number of tree leaves (contexts) to fit. */
    maxLeaves: z.number().int().positive(),

    // TODO(holdout-v1.5): holdouts are deferred to v1.5. The field is preserved
    // here so future docs can carry a non-zero value without a breaking schema
    // change, but it is *not yet wired through* — the snapshot orchestrator,
    // SQL runner, stats engine, SDK callback, and results UI all still ignore
    // a non-zero `holdoutPercent`. Operationally callers should keep this at 0
    // until the holdout pipeline ships.
    // Default `0` is supplied via `defaultValues` in
    // ContextualBanditModel's MakeModelClass config, per the project's
    // eslint rule banning `.default()` on Zod schemas.
    holdoutPercent: z.number().min(0).max(0.5),

    /** Version of the canonicalization algorithm used to derive context IDs. */
    canonicalFormVersion: z.number().int().nonnegative(),

    // ---------------------------------------------------------------------
    // Linked features — populated by the CB-side feature sync (PR-3)
    // ---------------------------------------------------------------------
    /**
     * Feature IDs that have a `contextual-bandit-ref` rule pointing at this
     * CB. Maintained by `featureContextualBanditSync.ts` (added in PR-3).
     */
    linkedFeatures: z.array(z.string()).optional(),

    /**
     * Drafts queued for auto-publish on `status -> running`. Mirror of
     * `experimentInterface.pendingFeatureDrafts`. Each
     * (featureId, revisionVersion) pair is its own row.
     */
    pendingFeatureDrafts: z
      .array(
        z
          .object({
            featureId: z.string(),
            revisionVersion: z.number(),
          })
          .strict(),
      )
      .optional(),

    // ---------------------------------------------------------------------
    // Snapshot scheduling — mirrors the equivalent experiment fields so the
    // CB agenda job (PR-5) can drive its own polling cadence.
    // ---------------------------------------------------------------------
    autoSnapshots: z.boolean().optional(),
    lastSnapshotAttempt: z.date().optional(),
    nextSnapshotAttempt: z.date().optional(),
  })
  .strict();

export type ContextualBanditInterface = z.infer<
  typeof contextualBanditValidator
>;

// ---------------------------------------------------------------------------
// External REST API schemas (`/api/v1/contextual-bandits/*`)
// ---------------------------------------------------------------------------
// Mirrors the experiment-template pattern: a `namedSchema` response shape +
// flat create/update bodies. The API DTO is intentionally a curated subset
// of `ContextualBanditInterface` so internal-only fields (linkedFeatures,
// pendingFeatureDrafts, snapshot scheduling, the legacy `experiment` FK)
// don't leak through the REST contract.
// ---------------------------------------------------------------------------

const apiContextualBanditPhase = z.object({
  dateStarted: z.iso.datetime(),
  dateEnded: z.iso.datetime().nullable().optional(),
  coverage: z.number().min(0).max(1).optional(),
  condition: z.string().optional(),
  seed: z.string().optional(),
  variationWeights: z.array(z.number()).optional(),
  currentLeafWeights: z.array(leafWeightValidator),
});

const apiContextualBanditVariation = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().optional(),
});

export const apiContextualBanditValidator = namedSchema(
  "ContextualBandit",
  apiBaseSchema.safeExtend({
    name: z.string(),
    description: z.string().optional(),
    hypothesis: z.string().optional(),
    project: z.string().optional(),
    owner: ownerField,
    ownerEmail: ownerEmailField,
    tags: z.array(z.string()),
    archived: z.boolean(),
    customFields: z.record(z.string(), z.any()).optional(),

    status: z.enum(contextualBanditStatus),
    dateStarted: z.iso.datetime().optional(),
    dateStopped: z.iso.datetime().optional(),

    trackingKey: z.string(),
    hashAttribute: z.string(),
    fallbackAttribute: z.string().optional(),
    hashVersion: z.union([z.literal(1), z.literal(2)]),
    disableStickyBucketing: z.boolean(),
    variations: z.array(apiContextualBanditVariation),

    datasource: z.string(),
    exposureQueryId: z.string(),
    segment: z.string().optional(),
    queryFilter: z.string().optional(),
    goalMetrics: z.array(z.string()),
    secondaryMetrics: z.array(z.string()),
    guardrailMetrics: z.array(z.string()),
    activationMetric: z.string().optional(),
    attributionModel: z.enum(attributionModel).optional(),
    skipPartialData: z.boolean().optional(),
    regressionAdjustmentEnabled: z.boolean().optional(),

    phases: z.array(apiContextualBanditPhase),

    /**
     * Ordered list of attribute column names used to derive context IDs.
     * Reported as `contextualAttributes` for backwards compatibility with
     * the original internal field name; the targeting-column alias on the
     * snapshot DTO is the same value.
     */
    contextualAttributes: z.array(z.string()),
    decisionMetric: z.string().optional(),
    maxContexts: z.number().int().positive(),
    treeModel: z.string(),
    minUsersPerLeaf: z.number().int().positive(),
    maxLeaves: z.number().int().positive(),
    holdoutPercent: z.number().min(0).max(0.5),
    canonicalFormVersion: z.number().int().nonnegative(),
  }),
);

export type ApiContextualBanditInterface = z.infer<
  typeof apiContextualBanditValidator
>;

export const apiListContextualBanditsValidator = {
  bodySchema: z.never(),
  querySchema: z.strictObject({
    projectId: z.string().optional(),
    datasourceId: z.string().optional(),
  }),
  paramsSchema: z.never(),
};

export const apiCreateContextualBanditBody = z.strictObject({
  name: z.string(),
  description: z.string().optional(),
  hypothesis: z.string().optional(),
  project: z.string().optional(),
  owner: ownerInputField.optional(),
  tags: z.array(z.string()).optional(),
  customFields: z.record(z.string(), z.any()).optional(),

  trackingKey: z.string(),
  hashAttribute: z.string().optional(),
  fallbackAttribute: z.string().optional(),
  hashVersion: z.union([z.literal(1), z.literal(2)]).optional(),
  disableStickyBucketing: z.boolean().optional(),

  variations: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      description: z.string().optional(),
    }),
  ),

  datasource: z.string(),
  exposureQueryId: z.string(),
  segment: z.string().optional(),
  queryFilter: z.string().optional(),
  goalMetrics: z.array(z.string()),
  secondaryMetrics: z.array(z.string()).optional(),
  guardrailMetrics: z.array(z.string()).optional(),
  activationMetric: z.string().optional(),
  attributionModel: z.enum(attributionModel).optional(),
  skipPartialData: z.boolean().optional(),
  regressionAdjustmentEnabled: z.boolean().optional(),

  contextualAttributes: z.array(z.string()),
  decisionMetric: z.string().optional(),
  maxContexts: z.number().int().positive().optional(),
  treeModel: z.string().optional(),
  minUsersPerLeaf: z.number().int().positive().optional(),
  maxLeaves: z.number().int().positive().optional(),
});

export type ApiCreateContextualBanditBody = z.infer<
  typeof apiCreateContextualBanditBody
>;

export const apiUpdateContextualBanditBody =
  apiCreateContextualBanditBody.partial();

export type ApiUpdateContextualBanditBody = z.infer<
  typeof apiUpdateContextualBanditBody
>;
