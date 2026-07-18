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
    "Acknowledge and proceed past ACKNOWLEDGE-class warnings: a value served to a running experiment, a locked dependent, dependents dropped by an archive, and warn-mode value errors. A blocked request lists what this would acknowledge in `warnings`. Does NOT clear validation-class failures (schema errors, cross-field invariants, downstream schema breaks, or custom-hook rejections) — those require `skipSchemaValidation`. On publish endpoints this also force-merges a draft whose base is stale, when you hold the bypass-approval permission.",
  );
export const skipSchemaValidationBodyField = z
  .boolean()
  .optional()
  .describe(
    "Force past VALIDATION-class failures: JSON-schema validation of the value(s) written, cross-field invariants, downstream schema breaks (a change that makes a dependent config or config-backed feature value violate its schema), and custom validation-hook rejections. Only honored for callers with org-wide bypass authority (the `bypassApprovalChecks` permission on all projects); ignored otherwise. Validation is enforced by default.",
  );
export const publishOverrideBodyFields = {
  ignoreWarnings: ignoreWarningsBodyField,
  skipSchemaValidation: skipSchemaValidationBodyField,
};

// Publish-endpoint `bypassApproval` flag. Accepted for compatibility but has
// no effect: approval bypass is implicit for callers with the permission (or
// under the org-level REST bypass setting), so gate messages no longer
// advertise this flag as a retry override.
export const bypassApprovalPublishBodyField = z
  .boolean()
  .optional()
  .describe(
    "Has no effect and is accepted only for backwards compatibility. Callers with the `bypassApprovalChecks` permission (or under the org-level REST bypass setting) bypass approval requirements automatically; all other callers must have the revision approved before publishing.",
  );

// Reported on a SUCCESSFUL publish when a gate that would otherwise have blocked
// the publish was bypassed by the caller's authority. Omitted entirely when no
// gate was bypassed, so a clean publish response stays lean.
export const publishBypassedGatesField = z
  .array(
    z
      .object({
        type: z
          .string()
          .describe(
            'The gate that was bypassed (e.g. "approval-required", "stale-base", "schema-break").',
          ),
        outcome: z.literal("bypassed"),
        via: z
          .string()
          .describe(
            'The bypass source: an override flag ("ignoreWarnings"), the caller\'s permission ("bypassApprovalChecks"), or the org setting ("restApiBypassesReviews").',
          ),
      })
      .strict(),
  )
  .optional()
  .describe(
    "Gates that would have blocked this publish but were bypassed by the caller's authority. Present only when at least one gate was bypassed.",
  );
