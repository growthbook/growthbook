import { z } from "zod";
import { apiPaginationFieldsValidator, paginationQueryFields } from "./shared";

import { namedSchema } from "./openapi-helpers";

// Corresponds to schemas/Member.yaml
export const apiMemberValidator = namedSchema(
  "Member",
  z
    .object({
      id: z.string(),
      name: z.string().optional(),
      email: z.string(),
      globalRole: z.string(),
      environments: z.array(z.string()).optional(),
      limitAccessByEnvironment: z.boolean().optional(),
      managedbyIdp: z.boolean().optional(),
      teams: z.array(z.string()).optional(),
      projectRoles: z
        .array(
          z.object({
            project: z.string(),
            role: z.string(),
            limitAccessByEnvironment: z.boolean(),
            environments: z.array(z.string()),
          }),
        )
        .optional(),
      lastLoginDate: z.string().meta({ format: "date-time" }).optional(),
      dateCreated: z.string().meta({ format: "date-time" }).optional(),
      dateUpdated: z.string().meta({ format: "date-time" }).optional(),
    })
    .strict(),
);

// Corresponds to payload-schemas/UpdateMemberRolePayload.yaml
const updateMemberRoleBody = z
  .object({
    member: z.object({
      role: z.string().optional(),
      environments: z.array(z.string()).optional(),
      projectRoles: z
        .array(
          z.object({
            project: z.string(),
            role: z.string(),
            environments: z.array(z.string()),
            limitAccessByEnvironment: z.boolean().optional(),
          }),
        )
        .optional(),
    }),
  })
  .strict();

const idParams = z
  .object({
    id: z.string().describe("The id of the requested resource"),
  })
  .strict();

export const listMembersValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      ...paginationQueryFields,
      userName: z.string().describe("Name of the user.").optional(),
      userEmail: z.string().describe("Email address of the user.").optional(),
      globalRole: z.string().describe("Name of the global role").optional(),
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z.intersection(
    z.object({
      members: z.array(apiMemberValidator),
    }),
    apiPaginationFieldsValidator,
  ),
  summary: "Get all organization members",
  operationId: "listMembers",
  tags: ["members"],
  method: "get" as const,
  path: "/members",
};

export const deleteMemberValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      deletedId: z.string(),
    })
    .strict(),
  summary: "Removes a single user from an organization",
  operationId: "deleteMember",
  tags: ["members"],
  method: "delete" as const,
  path: "/members/:id",
  exampleRequest: { params: { id: "abc123" } },
};

export const updateMemberRoleValidator = {
  bodySchema: updateMemberRoleBody,
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      updatedMember: z.object({
        id: z.string(),
        role: z.string(),
        environments: z.array(z.string()),
        limitAccessByEnvironment: z.boolean(),
        projectRoles: z
          .array(
            z.object({
              project: z.string(),
              role: z.string(),
              limitAccessByEnvironment: z.boolean(),
              environments: z.array(z.string()),
            }),
          )
          .optional(),
      }),
    })
    .strict(),
  summary:
    "Update a member's global role (including any enviroment restrictions, if applicable). Can also update a member's project roles if your plan supports it.",
  operationId: "updateMemberRole",
  tags: ["members"],
  method: "post" as const,
  path: "/members/:id/role",
};
