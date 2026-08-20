import { z } from "zod";
import {
  factMetricCreateArchivedField,
  postFactMetricBodyFields,
  refineFactMetricCreateBody,
} from "./fact-metrics";
import { postFactTableBody, postFactTableFilterBodyFields } from "./fact-table";
import { componentSchema } from "./openapi-helpers";

const resourceManagedByEnum = z
  .enum(["", "api", "admin"])
  .describe(
    'Fallback `managedBy` for Fact Tables and Fact Metrics that omit the field. Defaults to `"api"`. Filters inherit `"api"` only when the parent Fact Table is api-managed.',
  );

const bulkFactTableData = postFactTableBody
  .extend({
    columns: postFactTableBody.shape.columns.describe(
      'Optional array of column definitions for this fact table. On create, columns are stored as-is. On update, columns upsert by `column`: existing columns are patched, new columns are created, and columns not included are left unchanged. Omit `datatype` to leave an existing column\'s type untouched; send "" to reset it for auto-detection; new columns are auto-detected when `datatype` is omitted or "". Datatype-dependent properties (e.g. `alwaysInlineFilter`) are validated once the datatype is known. Slice-related properties require an enterprise license.',
    ),
  })
  .strict();

const bulkFactMetricData = postFactMetricBodyFields
  .extend({
    archived: factMetricCreateArchivedField,
  })
  .superRefine(refineFactMetricCreateBody);

const bulkImportResourceType = z.enum([
  "factTable",
  "factTableFilter",
  "factMetric",
]);

const bulkImportError = componentSchema(
  "BulkImportError",
  z
    .object({
      resourceType: bulkImportResourceType,
      id: z.string(),
      message: z.string(),
    })
    .strict(),
);

export type BulkImportError = z.infer<typeof bulkImportError>;

const managedByWritten = componentSchema(
  "BulkImportManagedByWritten",
  z
    .object({
      api: z.coerce.number().int(),
      admin: z.coerce.number().int(),
      none: z.coerce
        .number()
        .int()
        .describe('Count of resources written with managedBy ""'),
    })
    .strict(),
);

const postBulkImportFactsBody = z
  .object({
    defaultManagedBy: resourceManagedByEnum.optional(),
    dryRun: z.boolean().optional().describe("Validate with zero writes."),
    factTables: z
      .array(
        z.object({
          id: z.string(),
          data: bulkFactTableData,
        }),
      )
      .optional(),
    factTableFilters: z
      .array(
        z.object({
          factTableId: z.string(),
          id: z.string(),
          data: postFactTableFilterBodyFields,
        }),
      )
      .optional(),
    factMetrics: z
      .array(
        z.object({
          id: z.string(),
          data: bulkFactMetricData,
        }),
      )
      .optional(),
  })
  .strict();

export const postBulkImportFactsValidator = {
  bodySchema: postBulkImportFactsBody,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      success: z.boolean(),
      dryRun: z.boolean(),
      defaultManagedBy: resourceManagedByEnum,
      factTablesAdded: z.coerce.number().int(),
      factTablesUpdated: z.coerce.number().int(),
      factTableFiltersAdded: z.coerce.number().int(),
      factTableFiltersUpdated: z.coerce.number().int(),
      factMetricsAdded: z.coerce.number().int(),
      factMetricsUpdated: z.coerce.number().int(),
      managedByWritten,
      errors: z.array(bulkImportError),
    })
    .strict(),
  summary: "Bulk import fact tables, filters, and metrics",
  description:
    "Creates or updates Fact Tables, Fact Table filters, and Fact Metrics. Resources upsert by `id`. Pass `dryRun: true` to validate with zero writes. Not transactional: a live mid-loop failure returns HTTP 400 with write counts and `errors`.",
  operationId: "postBulkImportFacts",
  tags: ["fact-tables"],
  method: "post" as const,
  path: "/bulk-import/facts",
  exampleRequest: {
    body: { factTables: [], factTableFilters: [], factMetrics: [] },
  },
};
