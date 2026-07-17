import { z } from "zod";

import { namedSchema } from "./openapi-helpers";

// Legacy format (single range, inherits experiment's hashAttribute)
const legacyNamespaceValue = z.object({
  enabled: z.boolean(),
  name: z.string(),
  range: z.tuple([z.number(), z.number()]),
  format: z.literal("legacy").optional(),
});

// MultiRange format (multiple ranges, own hashAttribute, and hashVersion defined in the namespace itself)
const multiRangeNamespaceValue = z.object({
  enabled: z.boolean(),
  name: z.string(),
  ranges: z.array(z.tuple([z.number(), z.number()])),
  hashAttribute: z.string().optional(),
  hashVersion: z.number().optional(),
  format: z.literal("multiRange"),
});

// Union type to support both formats for backward compatibility
export const namespaceValue = z.union([
  legacyNamespaceValue,
  multiRangeNamespaceValue,
]);
export type NamespaceValue = z.infer<typeof namespaceValue>;

export const featurePrerequisite = z
  .object({
    id: z.string(),
    condition: z.string(),
  })
  .strict();
export type FeaturePrerequisite = z.infer<typeof featurePrerequisite>;

export const savedGroupTargeting = z
  .object({
    match: z.enum(["all", "none", "any"]),
    ids: z.array(z.string()),
  })
  .strict();
export type SavedGroupTargeting = z.infer<typeof savedGroupTargeting>;

/** Response-side pagination fields returned by list endpoints. */
export const apiPaginationFieldsValidator = namedSchema(
  "PaginationFields",
  z.object({
    limit: z.number().int(),
    offset: z.number().int(),
    count: z.number().int(),
    total: z.number().int(),
    hasMore: z.boolean(),
    nextOffset: z.union([z.number().int(), z.null()]),
  }),
);

export type ApiPaginationFields = z.infer<typeof apiPaginationFieldsValidator>;

/** Reusable pagination query params for API list endpoints. */
export const paginationQueryFields = {
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .describe("The number of items to return")
    .optional()
    .meta({ default: 10 }),
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .describe(
      "How many items to skip (use in conjunction with limit for pagination)",
    )
    .optional()
    .meta({ default: 0 }),
};

/** Accepts boolean query params in both string and native boolean form. */
export const booleanQueryField = z
  .union([
    z.literal("true"),
    z.literal("false"),
    z.literal("0"),
    z.literal("1"),
    z.boolean(),
  ])
  .optional();

/**
 * Self-hosted escape hatch for GitOps-style bulk exports. Honored only when
 * API_ALLOW_SKIP_PAGINATION is set on the server.
 */
export const skipPaginationQueryField = {
  skipPagination: z
    .union([
      z.literal("true"),
      z.literal("false"),
      z.literal("0"),
      z.literal("1"),
      z.boolean(),
    ])
    .describe(
      "If true, return all matching items and ignore limit/offset.\nSelf-hosted only. Has no effect unless API_ALLOW_SKIP_PAGINATION is set to true or 1.",
    )
    .meta({
      default: false,
      "x-selfHostedOnly": true,
      "x-requiresEnv": "API_ALLOW_SKIP_PAGINATION",
    })
    .optional(),
};

// Query flags shared by value-writing + publishing endpoints (features, configs)
// whose values are checked against a JSON/field schema. Both are read off the
// raw query at the context layer, so any endpoint that honors them must declare
// them here to keep them in the validated query (and in the API docs).
// DEPRECATED aliases: the body forms below are canonical.
export const schemaValidationQueryFields = {
  skipSchemaValidation: booleanQueryField
    .describe(
      "Deprecated — pass `skipSchemaValidation` in the request body instead.",
    )
    .meta({ deprecated: true }),
  ignoreWarnings: booleanQueryField
    .describe("Deprecated — pass `ignoreWarnings` in the request body instead.")
    .meta({ deprecated: true }),
};

// Publish-override body flags, shared by every publish-class endpoint so the
// names, semantics, and docs stay identical across entities. Body-canonical
// (the querystring forms above are deprecated aliases); read off the raw body
// at the context layer, so any endpoint that honors them must declare them in
// its (strict) body schema to accept them — which also documents them.
export const ignoreWarningsBodyField = z
  .boolean()
  .optional()
  .describe(
    "Acknowledge and proceed despite soft warnings: guard conflicts (running experiments reading the value, locked dependents, schema breaks introduced downstream), descendant-schema warnings, and warn-mode value errors. A blocked request returns the full list of warnings this would acknowledge in `warnings`. On publish endpoints this also force-merges a draft whose base is stale, when you hold the bypass-approval permission.",
  );
export const skipSchemaValidationBodyField = z
  .boolean()
  .optional()
  .describe(
    "Skip JSON-schema validation of the value(s) being written. Only honored for callers with org-wide bypass authority (the `bypassApprovalChecks` permission on all projects); ignored otherwise. Validation is enforced by default.",
  );
export const publishOverrideBodyFields = {
  ignoreWarnings: ignoreWarningsBodyField,
  skipSchemaValidation: skipSchemaValidationBodyField,
};

// Publish-endpoint form of `bypassApproval`: publish an unapproved revision
// when the org requires approvals. Callers with the permission (or under the
// org-level REST bypass setting) already bypass automatically; the flag exists
// so a blocked publish's `gates` response can name a concrete flag to retry
// with once the caller has bypass authority.
export const bypassApprovalPublishBodyField = z
  .boolean()
  .optional()
  .describe(
    "Publish a revision that has not been approved when the org requires approvals. Requires the `bypassApprovalChecks` permission (or the org-level REST bypass setting, either of which bypasses automatically). When approvals aren't required, this flag has no effect.",
  );
