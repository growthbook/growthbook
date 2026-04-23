import { z } from "zod";
import { namedSchema } from "./openapi-helpers";
import { paginationQueryFields } from "./shared";

export const apiNamespaceValidator = namedSchema(
  "Namespace",
  z.object({
    id: z
      .string()
      .describe(
        "The unique internal identifier for the namespace (e.g. 'ns-abc123').",
      ),
    displayName: z.string().describe("Human-readable display name."),
    description: z.string(),
    status: z.enum(["active", "inactive"]),
    format: z
      .enum(["legacy", "multiRange"])
      .describe(
        "Namespace format. 'multiRange' supports multiple ranges per experiment and a configurable hash attribute.",
      ),
    hashAttribute: z
      .string()
      .describe(
        "The user attribute used to assign bucket membership. Only present on multiRange namespaces.",
      )
      .optional(),
    seed: z
      .string()
      .describe(
        "The seed used for bucket hashing. Changing this re-randomizes traffic assignment for every experiment in this namespace. Use the rotateSeed endpoint to change it.",
      )
      .optional(),
  }),
);

export type ApiNamespace = z.infer<typeof apiNamespaceValidator>;

export const apiNamespaceMemberValidator = namedSchema(
  "NamespaceMember",
  z.object({
    experimentId: z.string().describe("The experiment tracking key."),
    experimentName: z.string().describe("Display name of the experiment."),
    link: z.string().describe("Relative URL to the experiment."),
    start: z
      .number()
      .describe("Range start value between 0 and 1 (inclusive)."),
    end: z.number().describe("Range end value between 0 and 1 (inclusive)."),
    environment: z
      .string()
      .describe(
        "Environment name. Present for experiments configured via feature flag rules; empty string for standalone experiment phases.",
      ),
  }),
);

export type ApiNamespaceMember = z.infer<typeof apiNamespaceMemberValidator>;

const nameParams = z
  .object({
    id: z.string().describe("The unique id of the namespace"),
  })
  .strict();

const listQuerySchema = z
  .object({
    ...paginationQueryFields,
  })
  .strict();

const paginatedResponseFields = z.object({
  limit: z.coerce.number().int(),
  offset: z.coerce.number().int(),
  count: z.coerce.number().int(),
  total: z.coerce.number().int(),
  hasMore: z.boolean(),
  nextOffset: z.union([z.coerce.number().int(), z.null()]),
});

export const listNamespacesValidator = {
  bodySchema: z.never(),
  querySchema: listQuerySchema,
  paramsSchema: z.never(),
  responseSchema: z.intersection(
    z.object({ namespaces: z.array(apiNamespaceValidator) }),
    paginatedResponseFields,
  ),
  summary: "Get all namespaces",
  operationId: "listNamespaces",
  tags: ["namespaces"],
  method: "get" as const,
  path: "/namespaces",
};

export const getNamespaceValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: nameParams,
  responseSchema: z.object({ namespace: apiNamespaceValidator }).strict(),
  summary: "Get a single namespace",
  operationId: "getNamespace",
  tags: ["namespaces"],
  method: "get" as const,
  path: "/namespaces/:id",
  exampleRequest: { params: { id: "ns-abc123" } },
};

const postNamespaceBody = z
  .object({
    displayName: z
      .string()
      .describe(
        "Human-readable display name. Must be unique within the organization.",
      ),
    description: z.string().optional(),
    status: z.enum(["active", "inactive"]).optional(),
    format: z
      .enum(["legacy", "multiRange"])
      .optional()
      .describe(
        "Namespace format. Defaults to 'multiRange', which supports multiple ranges per experiment and a configurable hash attribute.",
      ),
    hashAttribute: z
      .string()
      .describe(
        "Required when format is 'multiRange'. The user attribute (e.g. 'id', 'device_id') used to assign users to namespace buckets.",
      )
      .optional(),
  })
  .strict();

export const postNamespaceValidator = {
  bodySchema: postNamespaceBody,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z.object({ namespace: apiNamespaceValidator }).strict(),
  summary: "Create a namespace",
  operationId: "postNamespace",
  tags: ["namespaces"],
  method: "post" as const,
  path: "/namespaces",
  exampleRequest: {
    body: {
      displayName: "Checkout Flow",
      description: "Experiments on the checkout funnel",
      format: "multiRange" as const,
      hashAttribute: "id",
    },
  },
};

const putNamespaceBody = z
  .object({
    displayName: z.string().describe("Human-readable display name.").optional(),
    description: z.string().describe("Namespace description.").optional(),
    status: z
      .enum(["active", "inactive"])
      .describe("Set to 'inactive' to disable the namespace.")
      .optional(),
    hashAttribute: z
      .string()
      .describe(
        "Only applies to multiRange namespaces. Changes which user attribute is used for bucket hashing going forward.",
      )
      .optional(),
    id: z
      .string()
      .describe(
        "⚠️ Advanced / dangerous: rename the internal namespace ID. All experiments and feature rules that reference the old ID will break unless you also update them. Use with extreme caution.",
      )
      .optional(),
  })
  .strict();

export const putNamespaceValidator = {
  bodySchema: putNamespaceBody,
  querySchema: z.never(),
  paramsSchema: nameParams,
  responseSchema: z.object({ namespace: apiNamespaceValidator }).strict(),
  summary: "Update a namespace",
  operationId: "putNamespace",
  tags: ["namespaces"],
  method: "put" as const,
  path: "/namespaces/:id",
  exampleRequest: {
    params: { id: "ns-abc123" },
    body: { displayName: "Checkout v2", status: "inactive" as const },
  },
};

export const deleteNamespaceValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: nameParams,
  responseSchema: z
    .object({
      deletedId: z
        .string()
        .describe("The ID of the deleted namespace.")
        .meta({ example: "ns-abc123" }),
    })
    .strict(),
  summary: "Delete a namespace",
  operationId: "deleteNamespace",
  tags: ["namespaces"],
  method: "delete" as const,
  path: "/namespaces/:id",
  exampleRequest: { params: { id: "ns-abc123" } },
};

export const postNamespaceRotateSeedValidator = {
  bodySchema: z
    .object({
      seed: z
        .string()
        .describe(
          "A specific value to use as the new seed. If omitted, a random value is generated.",
        )
        .optional(),
    })
    .strict(),
  querySchema: z.never(),
  paramsSchema: nameParams,
  responseSchema: z.object({ namespace: apiNamespaceValidator }).strict(),
  summary: "Rotate namespace seed",
  description:
    "⚠️ Dangerous: sets a new seed for a multiRange namespace. Every user's bucket position within the namespace is re-computed immediately, which re-randomizes traffic assignment across **all** experiments currently using this namespace. Only do this if you intentionally want to reshuffle all allocations.",
  operationId: "postNamespaceRotateSeed",
  tags: ["namespaces"],
  method: "post" as const,
  path: "/namespaces/:id/rotateSeed",
  exampleRequest: { params: { id: "ns-abc123" } },
};

export const getNamespaceMembershipsValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: nameParams,
  responseSchema: z
    .object({ experiments: z.array(apiNamespaceMemberValidator) })
    .strict(),
  summary: "Get namespace membership",
  operationId: "getNamespaceMemberships",
  tags: ["namespaces"],
  method: "get" as const,
  path: "/namespaces/:id/memberships",
  exampleRequest: { params: { id: "ns-abc123" } },
};
