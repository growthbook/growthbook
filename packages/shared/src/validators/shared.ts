import { z } from "zod";

import { namedSchema } from "./openapi-helpers";

export const namespaceValue = z
  .object({
    enabled: z.boolean(),
    name: z.string(),
    range: z.tuple([z.number(), z.number()]),
  })
  .strict();
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
