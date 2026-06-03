import { z } from "zod";
import { apiBaseSchema, baseSchema } from "./base-model";
import {
  attributionModel,
  metricOverride,
  nextScheduledStatusUpdateValidator,
  statusUpdateScheduleValidator,
  variation,
} from "./experiments";
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

    // ---------------------------------------------------------------------
    // Scheduled status transitions — used by the CB scheduled-status agenda
    // job to start / stop a CB at a future time. Same shape as the
    // experiment equivalents so the retry-cap and failedAttempts semantics
    // stay consistent across model families.
    // ---------------------------------------------------------------------
    statusUpdateSchedule: statusUpdateScheduleValidator.optional().nullable(),
    nextScheduledStatusUpdate: nextScheduledStatusUpdateValidator
      .optional()
      .nullable(),
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
    /**
     * Transitional: parent experiment FK exposed on the API surface during
     * the decoupling window so callers (e.g. the front-end list page
     * linking to the detail page, which still reads from the experiment
     * endpoint) can resolve the paired experiment id without an extra
     * round-trip. Dropped in PR-8 once the detail page reads CB-native
     * data and the FK comes off the internal validator.
     *
     * @deprecated Will be removed after the CB decoupling migration.
     */
    experiment: z.string().optional(),
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

// ---------------------------------------------------------------------------
// Lifecycle endpoint schemas
// ---------------------------------------------------------------------------
// POST /:id/start, POST /:id/stop. The bodies are intentionally minimal —
// CB lifecycle today only needs the id; a future "stop with released
// variation" payload can extend the stop body without a breaking change.
//
// Return value is the full ApiContextualBanditInterface so the API caller
// gets the post-transition state without needing a follow-up GET.

export const apiContextualBanditStartValidator = {
  paramsSchema: z.strictObject({ id: z.string() }),
  bodySchema: z.strictObject({}).optional(),
  querySchema: z.never(),
};

export const apiContextualBanditStopValidator = {
  paramsSchema: z.strictObject({ id: z.string() }),
  bodySchema: z.strictObject({}).optional(),
  querySchema: z.never(),
};

export const apiContextualBanditLifecycleReturn = z.object({
  contextualBandit: apiContextualBanditValidator,
});

// POST /:id/refresh — manually trigger a snapshot run. Returns just the
// IDs of the freshly-created snapshot + (optional) CB event so callers
// can poll status without re-reading the whole CB doc. Mirrors the
// legacy `/experiments/:id/contextual-bandit/refresh` return shape.
export const apiContextualBanditRefreshValidator = {
  paramsSchema: z.strictObject({ id: z.string() }),
  bodySchema: z.strictObject({}).optional(),
  querySchema: z.never(),
};

export const apiContextualBanditRefreshReturn = z.object({
  snapshotId: z.string(),
  cbeId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// CB-native read endpoints
// ---------------------------------------------------------------------------
// These are intentionally NOT wired through the spec-pattern apiConfig — the
// TypeScript inference cascade that shows up when too many spec-style
// customHandlers share a model file makes that path unworkable for now.
// Instead they live as standalone non-BaseModel routes registered in
// `api/contextual-bandits/contextual-bandits.router.ts`, matching the
// pattern described in `api-patterns.md` for endpoints that don't fit the
// spec-based model.
//
// Wire shape parity with the legacy `/experiments/:id/contextual-bandit/*`
// GET endpoints is intentional: customers migrating from the old paths see
// identical response bodies. The `experiment` field on snapshot / event
// objects still refers to the parent experiment id (the snapshot/event
// collections key by experiment id under the hood) — that rename ships
// with PR-8 alongside the FK drop.

const cbIdAndSnapshotParam = z
  .object({
    id: z.string().describe("The Contextual Bandit id"),
    snapshotId: z.string().describe("The snapshot id"),
  })
  .strict();

const cbIdAndEventParam = z
  .object({
    id: z.string().describe("The Contextual Bandit id"),
    eventId: z.string().describe("The event id"),
  })
  .strict();

const cbIdOnlyParam = z
  .object({ id: z.string().describe("The Contextual Bandit id") })
  .strict();

const cbSnapshotResponseShape = z.object({
  id: z.string(),
  experiment: z.string(),
  phase: z.number(),
  status: z.enum(["pending", "running", "success", "error", "partial"]),
  weightsWereUpdated: z.boolean().optional(),
  contextualBanditEventId: z.string().nullable().optional(),
  error: z.string().optional(),
  dateCreated: z.string(),
});

const cbEventResponseShape = z.object({
  id: z.string(),
  experiment: z.string(),
  phase: z.number(),
  snapshotId: z.string(),
  weightsWereUpdated: z.boolean(),
  dateCreated: z.string(),
});

export const getCbCurrentValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: cbIdOnlyParam,
  responseSchema: z
    .object({
      phaseWeights: z
        .array(
          z.object({ contextId: z.string(), weights: z.array(z.number()) }),
        )
        .optional(),
      latestEvent: cbEventResponseShape.nullable(),
    })
    .strict(),
  summary: "Get current Contextual Bandit phase weights and latest event",
  operationId: "getCbCurrent",
  tags: ["contextual-bandits"],
  method: "get" as const,
  path: "/contextual-bandits/:id/current",
};

export const listCbSnapshotsValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      limit: z.coerce.number().int().positive().max(100).optional(),
    })
    .strict()
    .optional(),
  paramsSchema: cbIdOnlyParam,
  responseSchema: z
    .object({ snapshots: z.array(cbSnapshotResponseShape) })
    .strict(),
  summary: "List Contextual Bandit snapshots",
  operationId: "listCbSnapshots",
  tags: ["contextual-bandits"],
  method: "get" as const,
  path: "/contextual-bandits/:id/snapshots",
};

export const getCbSnapshotValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: cbIdAndSnapshotParam,
  responseSchema: z.object({ snapshot: cbSnapshotResponseShape }).strict(),
  summary: "Get a single Contextual Bandit snapshot",
  operationId: "getCbSnapshot",
  tags: ["contextual-bandits"],
  method: "get" as const,
  path: "/contextual-bandits/:id/snapshots/:snapshotId",
};

export const listCbEventsValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      limit: z.coerce.number().int().positive().max(100).optional(),
    })
    .strict()
    .optional(),
  paramsSchema: cbIdOnlyParam,
  responseSchema: z.object({ events: z.array(cbEventResponseShape) }).strict(),
  summary: "List Contextual Bandit weight-update events",
  operationId: "listCbEvents",
  tags: ["contextual-bandits"],
  method: "get" as const,
  path: "/contextual-bandits/:id/events",
};

export const getCbEventValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: cbIdAndEventParam,
  responseSchema: z.object({ event: cbEventResponseShape }).strict(),
  summary: "Get a single Contextual Bandit weight-update event",
  operationId: "getCbEvent",
  tags: ["contextual-bandits"],
  method: "get" as const,
  path: "/contextual-bandits/:id/events/:eventId",
};

export const getCbResultsValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: cbIdOnlyParam,
  responseSchema: z
    .object({
      contextualBanditSnapshot: z
        .object({
          attributes: z.array(z.string()),
          // Kept loose to avoid pulling the heavier stats validators into
          // this file. Internal Zod types in `validators/experiments.ts`
          // stay authoritative for runtime checking.
          responses: z.array(z.unknown()),
          leaf_map: z.array(z.unknown()).optional(),
        })
        .nullable(),
      latest: z
        .object({
          id: z.string(),
          status: z.enum(["running", "success", "error"]),
          error: z.string(),
          queries: z.array(z.unknown()),
          runStarted: z.string().nullable(),
          dateCreated: z.string(),
          multipleExposures: z.number(),
          type: z.string(),
          triggeredBy: z.string(),
        })
        .nullable(),
    })
    .strict(),
  summary: "Get latest Contextual Bandit results",
  description:
    "Returns the latest contextual-bandit stats engine output and the status of the most recent snapshot run for the CB's current phase. Same payload the GrowthBook UI uses to render the CB results table.",
  operationId: "getCbResults",
  tags: ["contextual-bandits"],
  method: "get" as const,
  path: "/contextual-bandits/:id/results",
};
