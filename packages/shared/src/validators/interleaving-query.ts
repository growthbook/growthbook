import { z } from "zod";
import { apiBaseSchema, baseSchema } from "./base-model";
import {
  ownerEmailField,
  ownerField,
  ownerInputField,
  optionalOwnerInputField,
} from "./owner-field";
import { namedSchema } from "./openapi-helpers";

/**
 * An Interleaving Query is the interleaving-specific replacement for borrowing
 * an Experiment Assignment Query off the datasource (same design as Contextual
 * Bandit Queries). It returns ONE ROW PER IMPRESSION in the SDK's nested
 * exposure shape — the item-level detail rides in an `items` JSON column
 * that GrowthBook's generated SQL unnests per warehouse dialect.
 */

export const INTERLEAVING_TIMESTAMP_COLUMN = "timestamp";
export const INTERLEAVING_EXPERIMENT_ID_COLUMN = "experiment_id";
export const INTERLEAVING_INTERLEAVE_ID_COLUMN = "interleave_id";
export const INTERLEAVING_ITEMS_COLUMN = "items";

// Metric fact-table columns used for attribution joins
export const INTERLEAVING_ITEM_ID_COLUMN = "item_id";

// Minimum share of a metric's engagement events that must carry a non-NULL
// interleave_id for the paired estimator to apply (else ownership). Column
// existence alone is not enough: NULL join keys never match, so a mostly
// unstamped fact table would silently analyze a sliver of the data.
export const INTERLEAVING_PAIRED_COVERAGE_THRESHOLD = 0.8;

// Fields inside each element of the `items` JSON array (SDK
// InterleavedItemMeta shape, camelCase)
export const INTERLEAVING_ITEM_FIELD_ITEM_ID = "itemId";
export const INTERLEAVING_ITEM_FIELD_VARIATION = "variation";
export const INTERLEAVING_ITEM_FIELD_COMPETITIVE = "competitive";
export const INTERLEAVING_ITEM_FIELD_POSITION = "position";

// Required output columns (plus the query's userIdType column). One row per
// impression; interleave_id is always required (the SDK always emits it).
export const INTERLEAVING_EXPOSURE_REQUIRED_COLUMNS = [
  INTERLEAVING_TIMESTAMP_COLUMN,
  INTERLEAVING_EXPERIMENT_ID_COLUMN,
  INTERLEAVING_INTERLEAVE_ID_COLUMN,
  INTERLEAVING_ITEMS_COLUMN,
] as const;

export const interleavingQueryValidator = baseSchema
  .extend({
    owner: ownerField,
    datasourceId: z.string(),
    name: z.string(),
    description: z.string().optional(),
    userIdType: z.string(),
    query: z.string(),
  })
  .strict();

export type InterleavingQueryInterface = z.infer<
  typeof interleavingQueryValidator
>;

export const apiInterleavingQueryValidator = namedSchema(
  "InterleavingQuery",
  apiBaseSchema.safeExtend({
    owner: ownerField,
    ownerEmail: ownerEmailField,
    datasourceId: z.string(),
    name: z.string(),
    description: z.string().optional(),
    userIdType: z.string(),
    query: z.string(),
  }),
);

export type ApiInterleavingQueryInterface = z.infer<
  typeof apiInterleavingQueryValidator
>;

export const apiListInterleavingQueriesValidator = {
  bodySchema: z.never(),
  querySchema: z.strictObject({
    datasourceId: z.string().optional(),
  }),
  paramsSchema: z.never(),
};

export const apiCreateInterleavingQueryBody = z.strictObject({
  owner: optionalOwnerInputField,
  datasourceId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  userIdType: z.string(),
  query: z.string(),
});

export type ApiCreateInterleavingQueryBody = z.infer<
  typeof apiCreateInterleavingQueryBody
>;

export const apiUpdateInterleavingQueryBody = z.strictObject({
  owner: ownerInputField.optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  userIdType: z.string().optional(),
  query: z.string().optional(),
});

export type ApiUpdateInterleavingQueryBody = z.infer<
  typeof apiUpdateInterleavingQueryBody
>;
