import { z } from "zod";

export const SQL_DEBUG_QUERY_KINDS = [
  "sql-explorer",
  "fact-table",
  "experiment-assignment",
  "feature-usage",
  "contextual-bandit-assignment",
  "identity-join",
  "metric",
  "segment",
  "dimension",
] as const;

export type SqlDebugQueryKind = (typeof SQL_DEBUG_QUERY_KINDS)[number];

export const sqlDebugContextValidator = z.object({
  requiredColumns: z.array(z.string().max(256)).max(100).optional(),
  userIdTypes: z.array(z.string().max(256)).max(100).optional(),
  timestampColumn: z.string().max(256).optional(),
  objectName: z.string().max(500).optional(),
});

export type SqlDebugContext = z.infer<typeof sqlDebugContextValidator>;

export const sqlDebugRequestValidator = z.object({
  datasourceId: z.string().min(1),
  sql: z.string().min(1).max(100_000),
  error: z.string().min(1).max(20_000),
  queryKind: z.enum(SQL_DEBUG_QUERY_KINDS),
  context: sqlDebugContextValidator.optional(),
  temperature: z.number().min(0).max(2).optional(),
});

export type SqlDebugRequest = z.infer<typeof sqlDebugRequestValidator>;

export const sqlDebugSuggestionValidator = z.object({
  explanation: z.string(),
  likelyCause: z.string(),
  suggestedSql: z.string().nullable(),
  fixSummary: z.string().nullable(),
});

export const sqlDebugResponseValidator = sqlDebugSuggestionValidator.extend({
  schemaAvailable: z.boolean(),
});

export type SqlDebugResponse = z.infer<typeof sqlDebugResponseValidator>;

export const SQL_DEBUG_PLAYBOOKS: Record<SqlDebugQueryKind, string> = {
  "sql-explorer":
    "This is an ad hoc, read-only SQL query. Preserve the user's intended result shape and make the smallest valid correction.",
  "fact-table":
    "This query defines a GrowthBook Fact Table. It must return the configured timestamp column and at least one configured user identifier column. Preserve supported template variables.",
  "experiment-assignment":
    "This experiment assignment query must return experiment_id, variation_id, timestamp, the selected user identifier, and all configured dimensions. If experiment_name or variation_name is returned, both must be returned.",
  "feature-usage":
    "This feature usage query must return timestamp and feature_key. It may also return value. Preserve those exact output aliases.",
  "contextual-bandit-assignment":
    "This contextual Bandit assignment query must preserve the required assignment, variation, timestamp, and identifier output aliases supplied in the request context.",
  "identity-join":
    "This identity join query must preserve every required identifier alias supplied in the request context.",
  metric:
    "This metric query must preserve every required output alias supplied in the request context and remain valid when embedded by GrowthBook.",
  segment:
    "This segment query must preserve every required output alias supplied in the request context and remain valid when embedded by GrowthBook.",
  dimension:
    "This dimension query must preserve every required output alias supplied in the request context and remain valid when embedded by GrowthBook.",
};
