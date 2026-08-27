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
 * Bandit Queries). It returns one row per impression x item from the SDK's
 * exposure events, and lives in its own collection.
 *
 * `hasInterleaveId` records whether the query outputs a non-null
 * `interleave_id` column (detected when the authoring modal test-runs the
 * query). It decides which estimator the analysis can use: impression-level
 * paired analysis when present, per-user ownership analysis when not.
 */

export const INTERLEAVING_TIMESTAMP_COLUMN = "timestamp";
export const INTERLEAVING_EXPERIMENT_ID_COLUMN = "experiment_id";
export const INTERLEAVING_ITEM_ID_COLUMN = "item_id";
export const INTERLEAVING_VARIATION_COLUMN = "variation";
export const INTERLEAVING_COMPETITIVE_COLUMN = "competitive";
export const INTERLEAVING_INTERLEAVE_ID_COLUMN = "interleave_id";
export const INTERLEAVING_POSITION_COLUMN = "position";

// Required output columns (plus the query's userIdType column)
export const INTERLEAVING_EXPOSURE_REQUIRED_COLUMNS = [
  INTERLEAVING_TIMESTAMP_COLUMN,
  INTERLEAVING_EXPERIMENT_ID_COLUMN,
  INTERLEAVING_ITEM_ID_COLUMN,
  INTERLEAVING_VARIATION_COLUMN,
  INTERLEAVING_COMPETITIVE_COLUMN,
] as const;

export const INTERLEAVING_EXPOSURE_OPTIONAL_COLUMNS = [
  INTERLEAVING_INTERLEAVE_ID_COLUMN,
  INTERLEAVING_POSITION_COLUMN,
] as const;

export const interleavingQueryValidator = baseSchema
  .extend({
    owner: ownerField,
    datasourceId: z.string(),
    name: z.string(),
    description: z.string().optional(),
    userIdType: z.string(),
    query: z.string(),
    hasInterleaveId: z.boolean(),
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
    hasInterleaveId: z.boolean(),
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
  hasInterleaveId: z.boolean(),
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
  hasInterleaveId: z.boolean().optional(),
});

export type ApiUpdateInterleavingQueryBody = z.infer<
  typeof apiUpdateInterleavingQueryBody
>;
