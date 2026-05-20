import { z } from "zod";
import { apiBaseSchema, baseSchema } from "./base-model";
import { ownerEmailField, ownerField, ownerInputField } from "./owner-field";

import { namedSchema } from "./openapi-helpers";

/**
 * Per-attribute configuration for a Contextual Bandit Query (CBAQ).
 *
 * - `categorical` tracks a top-N list of distinct string values.
 * - `quantitative` tracks numeric quantile bucket edges.
 *
 * Top values / bucket edges are cached on the CBAQ and refreshed via the
 * `/refresh-top-values` endpoint (A6). Fixed at MVP: no schedule, refresh
 * is synchronous-on-demand.
 */
export const contextualBanditQueryAttributeKind = [
  "categorical",
  "quantitative",
] as const;
export type ContextualBanditQueryAttributeKind =
  (typeof contextualBanditQueryAttributeKind)[number];

export const contextualBanditQueryAttribute = z
  .object({
    attribute: z.string().min(1),
    kind: z.enum(contextualBanditQueryAttributeKind),
    /**
     * Cap for categorical top-values (string levels) or quantile buckets
     * (quantitative). Slice that exceeds the cap is collapsed into
     * `"other"` by the SQL generator (A3). Bounded at the schema level to
     * keep the Mongo cap predictable.
     */
    maxLevels: z.number().int().positive().max(50).optional(),
    /**
     * Cached categorical top values, in canonical order. Refreshed by
     * `refreshTopValuesForCBAQ` (A3 service). May be empty before the
     * first refresh.
     */
    topValues: z.array(z.string()).optional(),
    /**
     * Cached numeric quantile bucket edges (length = numBuckets + 1).
     * Only set when `kind === "quantitative"`. Refreshed alongside
     * `topValues`.
     */
    bucketEdges: z.array(z.number()).optional(),
  })
  .strict();
export type ContextualBanditQueryAttribute = z.infer<
  typeof contextualBanditQueryAttribute
>;

export const contextualBanditQueryValidator = baseSchema.safeExtend({
  owner: ownerField,
  name: z.string().min(1),
  description: z.string(),
  /** Datasource the CBAQ targets — drives permission scope. */
  datasource: z.string(),
  /** Optional projects this CBAQ is scoped to (inherits from datasource). */
  projects: z.array(z.string()),
  /**
   * User id type the CBAQ joins on (e.g. `"userId"`, `"anonymousId"`).
   * Forwarded to the A3 SQL generator so the bucketing query joins
   * assignments to metrics on the right column.
   */
  userIdType: z.string(),
  /**
   * Raw SQL the warehouse runs to produce per-user assignment rows. Output
   * columns: the configured `userIdType`, `variation_id`, and one column per
   * attribute in `attributes[]`. The reward metric is sourced separately from
   * the experiment's goal metric (fact table) and joined in by the A3 SQL
   * generator — the contents of `query` are user-authored.
   */
  query: z.string(),
  attributes: z.array(contextualBanditQueryAttribute),
  /**
   * Lookback window (days) used by `refreshTopValuesForCBAQ` when sampling
   * top values from the warehouse. Capped to avoid scanning unbounded data.
   */
  topValuesLookbackDays: z.number().int().positive().max(365),
  /** Timestamp of the most recent successful top-values refresh. */
  topValuesLastRefreshed: z.date().optional(),
});

export type ContextualBanditQueryInterface = z.infer<
  typeof contextualBanditQueryValidator
>;

// ---------------------------------------------------------------------------
// API schemas
// ---------------------------------------------------------------------------

const apiContextualBanditQueryAttribute = z
  .object({
    attribute: z.string(),
    kind: z.enum(contextualBanditQueryAttributeKind),
    maxLevels: z.number().optional(),
    topValues: z.array(z.string()).optional(),
    bucketEdges: z.array(z.number()).optional(),
  })
  .strict();

export const apiContextualBanditQueryValidator = namedSchema(
  "ContextualBanditQuery",
  apiBaseSchema.safeExtend({
    owner: ownerField,
    ownerEmail: ownerEmailField,
    name: z.string(),
    description: z.string(),
    datasource: z.string(),
    projects: z.array(z.string()),
    userIdType: z.string(),
    query: z.string(),
    attributes: z.array(apiContextualBanditQueryAttribute),
    topValuesLookbackDays: z.number(),
    topValuesLastRefreshed: z.iso.datetime().optional(),
  }),
);

export const apiCreateContextualBanditQueryBody = z.strictObject({
  name: z.string(),
  description: z.string().optional(),
  datasource: z.string(),
  projects: z.array(z.string()).optional(),
  userIdType: z.string(),
  query: z.string(),
  attributes: z
    .array(
      z.strictObject({
        attribute: z.string(),
        kind: z.enum(contextualBanditQueryAttributeKind),
        maxLevels: z.number().int().positive().max(50).optional(),
      }),
    )
    .min(1),
  topValuesLookbackDays: z.number().int().positive().max(365).optional(),
  owner: ownerInputField.optional(),
});

export const apiUpdateContextualBanditQueryBody =
  apiCreateContextualBanditQueryBody.partial();
