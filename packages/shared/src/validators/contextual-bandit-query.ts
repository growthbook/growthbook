import { z } from "zod";
import { apiBaseSchema, baseSchema } from "./base-model";
import { namedSchema } from "./openapi-helpers";

/**
 * A Contextual Bandit Query is the bandit-specific replacement for borrowing an
 * Experiment Assignment Query (exposure query) off the datasource. It lives in its
 * own collection rather than on `datasource.settings.queries.exposure[]`, so the CB
 * SQL contract (leaf_id / snapshot_update_count / variation_weights output columns
 * plus targeting-attribute context columns) no longer overloads the EAQ.
 *
 * `targetingAttributeColumns` is required and must be non-empty — a bandit with no
 * context to split on is not a contextual bandit. The non-empty + safe-identifier
 * invariants are enforced in `ContextualBanditQueryModel.customValidation` (server
 * source of truth) and mirrored in the authoring modal for UX.
 */
export const contextualBanditQueryValidator = baseSchema
  .extend({
    datasourceId: z.string(),
    name: z.string(),
    description: z.string().optional(),
    userIdType: z.string(),
    query: z.string(),
    targetingAttributeColumns: z.array(z.string()),
  })
  .strict();

export type ContextualBanditQueryInterface = z.infer<
  typeof contextualBanditQueryValidator
>;

export const apiContextualBanditQueryValidator = namedSchema(
  "ContextualBanditQuery",
  apiBaseSchema.safeExtend({
    datasourceId: z.string(),
    name: z.string(),
    description: z.string().optional(),
    userIdType: z.string(),
    query: z.string(),
    targetingAttributeColumns: z.array(z.string()),
  }),
);

export type ApiContextualBanditQueryInterface = z.infer<
  typeof apiContextualBanditQueryValidator
>;

export const apiListContextualBanditQueriesValidator = {
  bodySchema: z.never(),
  querySchema: z.strictObject({
    datasourceId: z.string().optional(),
  }),
  paramsSchema: z.never(),
};

export const apiCreateContextualBanditQueryBody = z.strictObject({
  datasourceId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  userIdType: z.string(),
  query: z.string(),
  targetingAttributeColumns: z.array(z.string()),
});

export type ApiCreateContextualBanditQueryBody = z.infer<
  typeof apiCreateContextualBanditQueryBody
>;

export const apiUpdateContextualBanditQueryBody = z.strictObject({
  name: z.string().optional(),
  description: z.string().optional(),
  userIdType: z.string().optional(),
  query: z.string().optional(),
  targetingAttributeColumns: z.array(z.string()).optional(),
});

export type ApiUpdateContextualBanditQueryBody = z.infer<
  typeof apiUpdateContextualBanditQueryBody
>;
