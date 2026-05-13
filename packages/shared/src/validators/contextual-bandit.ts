import { z } from "zod";
import { apiBaseSchema, baseSchema } from "./base-model";
import { contextualBanditTreeModel } from "./contextual-bandit-event";
import { namedSchema } from "./openapi-helpers";

/**
 * Per-leaf allocation weights produced by a Contextual Bandit tick.
 *
 * `contextId` is the canonical hash from `deriveContextId` (A1) and is the
 * stable join key across CBE ticks and SDK payload `contexts` entries.
 * `condition` is the parsed GrowthBook condition object the SDK passes
 * directly to `evalCondition` (A4) — stored as JSON, not the canonical
 * string, so the SDK payload builder can copy it through without parsing.
 * `weights` is parallel to the parent experiment's `variations[]`. `leafId`
 * is an optional opaque pointer into the stats engine's tree representation
 * for debugging.
 */
export const leafWeightValidator = z
  .object({
    contextId: z.string(),
    condition: z.record(z.string(), z.unknown()),
    weights: z.array(z.number()),
    leafId: z.string().optional(),
  })
  .strict();
export type LeafWeight = z.infer<typeof leafWeightValidator>;

/**
 * Per-phase Contextual Bandit state. Mirrors the experiment phase index
 * (zero-based) so the orchestrator (A6) can join CBE → CB phase by index
 * alone without unpacking the experiment. `seed` is rotated each tick to
 * keep tree-fit reproducibility deterministic per-phase but unique per-tick.
 */
export const cbPhaseValidator = z
  .object({
    phase: z.number().int().nonnegative(),
    seed: z.number().int(),
    /**
     * Latest per-context allocation weights produced by the most recent
     * `ContextualBanditEvent`. Frozen on the CB doc so the SDK payload
     * builder (A6) can read a known-good policy state without joining
     * back through CBE → CBS history.
     */
    currentLeafWeights: z.array(leafWeightValidator),
    /**
     * Pointer to the CBE that produced `currentLeafWeights`. Lets the SDK
     * payload builder freeze a known-good policy state and lets the
     * orchestrator detect a stale weights snapshot before re-emitting.
     */
    lastContextualBanditEventId: z.string().optional(),
    dateStarted: z.date().optional(),
  })
  .strict();
export type CBPhase = z.infer<typeof cbPhaseValidator>;

/**
 * Sister-to-experiments doc holding all Contextual Bandit configuration
 * + per-phase state for a single experiment. 1:1 with experiments.id via
 * the `experiment` field (uniquely indexed — see ContextualBanditModel).
 *
 * Defaults are NOT declared here via `.default()` (project rule); they
 * live in `defaultValues` on the back-end model config so the inferred
 * type stays "field is required" and writes through `dangerousCreate*`
 * still get the same defaults applied.
 *
 * `holdoutPercent` / `stickyBucketing` are pinned to `0` / `false` for
 * MVP (source plan A guardrails). Carrying them as fields means Phase B
 * can lift the guardrail without a migration.
 */
export const contextualBanditValidator = baseSchema.safeExtend({
  /** FK to experiments.id. Unique per (organization, experiment). */
  experiment: z.string(),
  /** FK to contextualbanditqueries.id (CBAQ). */
  cbaqId: z.string(),
  /**
   * Subset of CBAQ attributes this experiment optimises against. Subset
   * validation against `cbaqId.attributes` is deferred to A6 (orchestrator
   * settings serializer); kept loose at the Zod layer.
   */
  contextualAttributes: z.array(z.string()),
  /**
   * Cap on distinct contexts produced by the tree fit. Slice that exceeds
   * the cap is collapsed into a single `"other"` leaf by the orchestrator
   * (A6).
   */
  maxContexts: z.number().int().positive(),
  treeModel: z.enum(contextualBanditTreeModel),
  /**
   * Minimum users a tree leaf must contain to be emitted by the stats
   * engine (A5). Acts as a regularizer — under-populated splits collapse
   * back into the parent leaf.
   */
  minUsersPerLeaf: z.number().int().positive(),
  /**
   * Hard cap on tree leaves. Independent of `maxContexts` — the tree fit
   * may emit fewer leaves than contexts when several contexts collapse
   * into the same leaf.
   */
  maxLeaves: z.number().int().positive(),
  holdoutPercent: z.literal(0),
  stickyBucketing: z.literal(false),
  /**
   * `CANONICAL_FORM_VERSION` at write time (A1). Pinned to `"v1"` for
   * MVP; carried as a field so consumers can detect a re-canonicalization
   * and treat older `contextId`s as stale.
   */
  canonicalFormVersion: z.literal("v1"),
  /**
   * Optional cadence override for `runContextualBanditSnapshot` (A6).
   * Absent ⇒ caller decides. Carried over from the previous
   * `contextualBanditConfig.scheduleHours` so the field exists once A6
   * needs it.
   */
  scheduleHours: z.number().positive().optional(),
  phases: z.array(cbPhaseValidator),
});

export type ContextualBanditInterface = z.infer<
  typeof contextualBanditValidator
>;

// ---------------------------------------------------------------------------
// API schema
// ---------------------------------------------------------------------------

const apiCbPhase = z
  .object({
    phase: z.number(),
    seed: z.number(),
    currentLeafWeights: z.array(
      z
        .object({
          contextId: z.string(),
          condition: z.record(z.string(), z.unknown()),
          weights: z.array(z.number()),
          leafId: z.string().optional(),
        })
        .strict(),
    ),
    lastContextualBanditEventId: z.string().optional(),
    dateStarted: z.iso.datetime().optional(),
  })
  .strict();

export const apiContextualBanditValidator = namedSchema(
  "ContextualBandit",
  apiBaseSchema.safeExtend({
    experiment: z.string(),
    cbaqId: z.string(),
    contextualAttributes: z.array(z.string()),
    maxContexts: z.number(),
    treeModel: z.enum(contextualBanditTreeModel),
    minUsersPerLeaf: z.number(),
    maxLeaves: z.number(),
    holdoutPercent: z.literal(0),
    stickyBucketing: z.literal(false),
    canonicalFormVersion: z.literal("v1"),
    scheduleHours: z.number().optional(),
    phases: z.array(apiCbPhase),
  }),
);
