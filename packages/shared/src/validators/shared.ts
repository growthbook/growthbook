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

/** Advisories returned alongside a 2xx describing how a request was interpreted. */
export const inputWarningsField = z
  .array(z.string())
  .optional()
  .describe(
    "Non-fatal advisories about how the request was interpreted — request fields that were ignored, or accepted under an undocumented name.",
  );

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

// Comma-separated query param restricted to a fixed set of values
// (case-insensitive), e.g. `?result=won,lost`.
//
// At runtime the value is a plain string validated by the refinement. The
// meta() overrides the generated OpenAPI schema to the spec-correct encoding
// for CSV enums — `type: array` with `items.enum` and `explode: false` (the
// generator hoists `explode` to the parameter level) — so the docs surface
// the allowed values instead of a bare string.
export const csvQueryField = (
  allowed: readonly string[],
  description: string,
) => {
  const allowedSet = new Set(allowed.map((v) => v.toLowerCase()));
  return (
    z
      .string()
      .refine(
        (v) =>
          v
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
            .every((t) => allowedSet.has(t.toLowerCase())),
        {
          message: `Must be a comma-separated list of: ${allowed.join(", ")}`,
        },
      )
      // describe() must come after refine() — refine() clones the schema and
      // the clone doesn't carry registry metadata, so the description would be
      // dropped from the generated OpenAPI spec
      .describe(description)
      .meta({
        type: "array",
        items: { type: "string", enum: [...allowed] },
        explode: false,
      })
      .optional()
  );
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
    "Set to true to acknowledge the warnings listed in a blocked response and continue. This covers experiment guards, locked dependents, and references affected by an archive. When the organization treats schema failures as warnings, it also covers schema and invariant warnings. It never bypasses a rejected Custom Hook. On revision publish endpoints, it can also force-publish an out-of-date draft when the caller has Bypass draft approvals access.",
  );
export const skipSchemaValidationBodyField = z
  .boolean()
  .optional()
  .describe(
    "Set to true to publish despite schema validation errors, failed invariants, or schema changes that invalidate dependent resources. This does not bypass a rejected Custom Hook; use `skipHooks` for that. The caller must have Bypass draft approvals access for Feature Flags, Configs, and Constants in every Project. Otherwise, this field is ignored.",
  );
export const skipHooksBodyField = z
  .boolean()
  .optional()
  .describe(
    "Set to true to publish despite a Custom Hook rejection. This does not bypass schema validation; use `skipSchemaValidation` for that. The caller must have Bypass draft approvals access for Feature Flags, Configs, and Constants in every Project. Otherwise, this field is ignored.",
  );
export const publishOverrideBodyFields = {
  ignoreWarnings: ignoreWarningsBodyField,
  skipSchemaValidation: skipSchemaValidationBodyField,
  skipHooks: skipHooksBodyField,
};

// Publish-endpoint `bypassApproval` flag. Accepted for compatibility but has
// no effect: approval bypass is implicit for callers with the permission (or
// under the org-level REST bypass setting), so gate messages no longer
// advertise this flag as a retry override.
export const bypassApprovalPublishBodyField = z
  .boolean()
  .optional()
  .describe(
    "Deprecated and ignored. Approval is bypassed automatically when the caller has Bypass draft approvals access for this resource or when the organization enables the REST API approval bypass. Otherwise, the revision must be approved before it can be published.",
  );

/**
 * The closed set of bypass sources a response may report: a request field
 * (`ignoreWarnings`, the privileged `skipSchemaValidation`, `skipHooks`), the
 * caller's permission on the entity (`bypassApprovalPermission`), or an
 * organization setting (`restApiBypassesReviews`, or `revertsBypassApproval` on a
 * revert).
 *
 * The source of truth for both the runtime schema and `BypassVia`, so a handler
 * cannot report a provenance the API docs do not describe.
 */
export const bypassViaValues = [
  "ignoreWarnings",
  "skipSchemaValidation",
  "skipHooks",
  "bypassApprovalPermission",
  "restApiBypassesReviews",
  "revertsBypassApproval",
] as const;

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
          .enum(bypassViaValues)
          .describe(
            "How the gate was bypassed. The value identifies a request field (`ignoreWarnings`, `skipSchemaValidation`, or `skipHooks`), the caller's permission (`bypassApprovalPermission`), or an organization setting (`restApiBypassesReviews`, or `revertsBypassApproval` on a revert).",
          ),
      })
      .strict(),
  )
  .optional()
  .describe(
    "Gates that would have blocked this publish but were bypassed by the caller's authority. Present only when at least one gate was bypassed.",
  );

/** Optional deferred-publish state shared by all revision responses. */
export const revisionScheduleResponseFields = {
  autoPublishOnApproval: z
    .boolean()
    .optional()
    .describe("Publish automatically the moment this revision is approved."),
  autoPublishEnabledBy: z
    .string()
    .optional()
    .describe(
      "User the deferred publish will run as. Its authority is re-checked when the publish fires.",
    ),
  scheduledPublishAt: z
    .string()
    .meta({ format: "date-time" })
    .optional()
    .describe(
      "When the deferred publish fires. Absent when the revision publishes on approval instead, or is not armed at all.",
    ),
  scheduledPublishLockEdits: z
    .boolean()
    .optional()
    .describe("Content edits to this revision are frozen until it fires."),
  scheduledPublishLockOthers: z
    .boolean()
    .optional()
    .describe(
      "Other revisions of the same resource cannot publish until this one fires or is cancelled.",
    ),
  scheduledPublishBypassApproval: z
    .boolean()
    .optional()
    .describe(
      "Armed by a caller who bypassed the approval requirement. Such a schedule must be cancelled and re-armed rather than edited.",
    ),
  scheduledPublishAttempts: z
    .number()
    .int()
    .optional()
    .describe("How many times the poller has tried to publish this revision."),
  scheduledPublishLastError: z
    .string()
    .optional()
    .describe("Why the most recent deferred-publish attempt failed."),
  scheduledPublishGaveUpAt: z
    .string()
    .meta({ format: "date-time" })
    .optional()
    .describe(
      "When the poller stopped retrying. Giving up CLEARS the schedule and disarms auto-publish, so nothing fires again until the revision is re-armed. The draft is left open, with `scheduledPublishLastError` preserved for context.",
    ),
};
