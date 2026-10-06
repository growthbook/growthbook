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

// Fields inside each element of the `items` JSON array (SDK
// InterleavedItemMeta shape, camelCase)
export const INTERLEAVING_ITEM_FIELD_ITEM_ID = "itemId";
export const INTERLEAVING_ITEM_FIELD_VARIATION = "variation";
export const INTERLEAVING_ITEM_FIELD_COMPETITIVE = "competitive";

// Required output columns (plus the analyzed identifier column). One row per
// impression; interleave_id is always required (the SDK always emits it).
export const INTERLEAVING_EXPOSURE_REQUIRED_COLUMNS = [
  INTERLEAVING_TIMESTAMP_COLUMN,
  INTERLEAVING_EXPERIMENT_ID_COLUMN,
  INTERLEAVING_INTERLEAVE_ID_COLUMN,
  INTERLEAVING_ITEMS_COLUMN,
] as const;

const interleavingQueryFields = {
  datasourceId: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  // Identifier columns the query outputs; each analysis picks one. Capped at
  // one until analyses can choose, so lifting the cap needs no migration.
  userIdTypes: z.array(z.string().min(1)).min(1).max(1),
  query: z.string().min(1),
};

export const interleavingQueryValidator = baseSchema
  .extend({ owner: ownerField, ...interleavingQueryFields })
  .strict();

export type InterleavingQueryInterface = z.infer<
  typeof interleavingQueryValidator
>;

export const apiInterleavingQueryValidator = namedSchema(
  "InterleavingQuery",
  apiBaseSchema.safeExtend({
    owner: ownerField,
    ownerEmail: ownerEmailField,
    ...interleavingQueryFields,
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
  ...interleavingQueryFields,
});

export type ApiCreateInterleavingQueryBody = z.infer<
  typeof apiCreateInterleavingQueryBody
>;

// datasourceId is immutable (a readonly field on the model)
export const apiUpdateInterleavingQueryBody = z
  .strictObject({ owner: ownerInputField, ...interleavingQueryFields })
  .omit({ datasourceId: true })
  .partial();

export type ApiUpdateInterleavingQueryBody = z.infer<
  typeof apiUpdateInterleavingQueryBody
>;
