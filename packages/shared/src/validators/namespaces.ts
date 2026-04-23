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
        "The seed used for bucket hashing. Changing this re-randomizes which traffic is eligible for which experiment. Use the rotateSeed endpoint to change it.",
      )
      .optional(),
  }),
);

export type ApiNamespace = z.infer<typeof apiNamespaceValidator>;

const rangesTuple = z
  .array(z.tuple([z.number(), z.number()]))
  .describe(
    "The ranges claimed within this namespace, as [start, end] pairs between 0 and 1.",
  );

export const apiNamespaceExperimentMemberValidator = namedSchema(
  "NamespaceExperimentMember",
  z.object({
    id: z.string().describe("The internal experiment ID."),
    name: z.string().describe("Display name of the experiment."),
    trackingKey: z
      .string()
      .describe("The experiment tracking key used by the SDK."),
    ranges: rangesTuple,
  }),
);

export type ApiNamespaceExperimentMember = z.infer<
  typeof apiNamespaceExperimentMemberValidator
>;

export const apiNamespaceFeatureRuleMemberValidator = namedSchema(
  "NamespaceFeatureRuleMember",
  z.object({
    featureId: z.string().describe("The feature flag ID."),
    environment: z.string().describe("The environment this rule is active in."),
    trackingKey: z
      .string()
      .describe(
        "The tracking key for the experiment rule. Falls back to the feature ID if not set.",
      ),
    ranges: rangesTuple,
  }),
);

export type ApiNamespaceFeatureRuleMember = z.infer<
  typeof apiNamespaceFeatureRuleMemberValidator
>;

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
  description:
    "Permanently removes a namespace from the organization. Returns a 400 error if any active experiments or feature flag rules currently reference this namespace — remove or disable those references first.",
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
    "⚠️ Dangerous: sets a new seed for a multiRange namespace. Every user's bucket position within the namespace is re-computed immediately, which re-randomizes traffic eligibility for **all** experiments currently using this namespace. Only do this if you intentionally want to reshuffle all allocations across experiments. This could be useful when re-using a namespace for a new set of experiments.",
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
    .object({
      experiments: z.array(apiNamespaceExperimentMemberValidator),
      featureRules: z.array(apiNamespaceFeatureRuleMemberValidator),
    })
    .strict(),
  summary: "Get namespace membership",
  operationId: "getNamespaceMemberships",
  tags: ["namespaces"],
  method: "get" as const,
  path: "/namespaces/:id/memberships",
  exampleRequest: { params: { id: "ns-abc123" } },
};
