import { z } from "zod";
import { paginationQueryFields } from "./shared";

import { namedSchema } from "./openapi-helpers";

export const memberRoleInfo = z.strictObject({
  role: z.string(),
  limitAccessByEnvironment: z.boolean(),
  environments: z.array(z.string()),
  teams: z.array(z.string()).optional(),
});

export const projectMemberRole = memberRoleInfo.safeExtend({
  project: z.string(),
});

export const memberRoleWithProjects = memberRoleInfo.safeExtend({
  projectRoles: z.array(projectMemberRole).optional(),
});

export const invite = memberRoleWithProjects.safeExtend({
  email: z.string(),
  key: z.string(),
  dateCreated: z.date(),
  invitedBy: z.string().optional(),
});

export const pendingMember = memberRoleWithProjects.safeExtend({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  dateCreated: z.date(),
});

export const member = memberRoleWithProjects.safeExtend({
  id: z.string(),
  dateCreated: z.date().optional(),
  externalId: z.string().optional(),
  managedByIdp: z.boolean().optional(),
  lastLoginDate: z.date().optional(),
});

export const expandedMemberInfo = {
  email: z.string(),
  name: z.string(),
  verified: z.boolean(),
  numTeams: z.number().optional(),
};

export const expandedMember = member.safeExtend(expandedMemberInfo);

// --- API validators (correspond to openapi YAML specs) ---

// Corresponds to schemas/Organization.yaml
export const apiOrganizationValidator = namedSchema(
  "Organization",
  z
    .object({
      id: z
        .string()
        .describe("The Growthbook unique identifier for the organization")
        .optional(),
      externalId: z
        .string()
        .describe(
          "An optional identifier that you use within your company for the organization",
        )
        .optional(),
      dateCreated: z
        .string()
        .meta({ format: "date-time" })
        .describe("The date the organization was created")
        .optional(),
      name: z.string().describe("The name of the organization").optional(),
      ownerEmail: z
        .string()
        .describe("The email address of the organization owner")
        .optional(),
    })
    .strict(),
);

export type ApiOrganization = z.infer<typeof apiOrganizationValidator>;

// Corresponds to payload-schemas/PostOrganizationPayload.yaml
const postOrganizationBody = z
  .object({
    name: z.string().describe("The name of the organization"),
    externalId: z
      .string()
      .describe(
        "An optional identifier that you use within your company for the organization",
      )
      .optional(),
  })
  .strict();

// Corresponds to payload-schemas/PutOrganizationPayload.yaml
const putOrganizationBody = z
  .object({
    name: z.string().describe("The name of the organization").optional(),
    externalId: z
      .string()
      .describe(
        "An optional identifier that you use within your company for the organization",
      )
      .optional(),
  })
  .strict();

const idParams = z
  .object({
    id: z.string().describe("The id of the requested resource"),
  })
  .strict();

export const listOrganizationsValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      search: z
        .string()
        .describe(
          "Search string to search organization names, owner emails, and external ids by",
        )
        .optional(),
      ...paginationQueryFields,
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z.intersection(
    z.object({
      organizations: z.array(apiOrganizationValidator),
    }),
    z.object({
      limit: z.coerce.number().int(),
      offset: z.coerce.number().int(),
      count: z.coerce.number().int(),
      total: z.coerce.number().int(),
      hasMore: z.boolean(),
      nextOffset: z.union([z.coerce.number().int(), z.null()]),
    }),
  ),
  summary:
    "Get all organizations (only for super admins on multi-org Enterprise Plan only)",
  operationId: "listOrganizations",
  tags: ["organizations"],
  method: "get" as const,
  path: "/organizations",
};

export const postOrganizationValidator = {
  bodySchema: postOrganizationBody,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      organization: apiOrganizationValidator,
    })
    .strict(),
  summary:
    "Create a single organization (only for super admins on multi-org Enterprise Plan only)",
  operationId: "postOrganization",
  tags: ["organizations"],
  method: "post" as const,
  path: "/organizations",
  exampleRequest: { body: { name: "My Subsidiary" } },
};

export const putOrganizationValidator = {
  bodySchema: putOrganizationBody,
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      organization: apiOrganizationValidator,
    })
    .strict(),
  summary:
    "Edit a single organization (only for super admins on multi-org Enterprise Plan only)",
  operationId: "putOrganization",
  tags: ["organizations"],
  method: "put" as const,
  path: "/organizations/:id",
  exampleRequest: {
    params: { id: "abc123" },
    body: { name: "My Subsidiary", externalId: "subsidiary-123" },
  },
};
