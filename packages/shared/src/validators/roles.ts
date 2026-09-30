import { z } from "zod";
import { POLICIES } from "../permissions/permissions.constants";
import { namedSchema } from "./openapi-helpers";

export const apiRoleValidator = namedSchema(
  "Role",
  z
    .object({
      id: z.string(),
      displayName: z.string().optional(),
      description: z.string(),
      policies: z.array(z.string()),
      isCustom: z.boolean().describe("False for the built-in roles"),
      deactivated: z
        .boolean()
        .describe(
          "Deactivated roles are hidden in the app and can't be given to API keys. Existing assignments keep working.",
        ),
    })
    .strict(),
);

const roleFields = {
  displayName: z.string().max(64).optional(),
  description: z.string().max(100),
  policies: z.array(z.enum(POLICIES)),
};

const idParams = z.object({ id: z.string().describe("The role id") }).strict();

const roleResponse = z.object({ role: apiRoleValidator }).strict();

const customRolesGate =
  "Custom roles require an Enterprise plan and permission to manage custom roles.";

export const listRolesValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z.object({ roles: z.array(apiRoleValidator) }).strict(),
  summary: "Get all roles, built-in and custom",
  operationId: "listRoles",
  tags: ["roles"],
  method: "get" as const,
  path: "/roles",
};

export const postRoleValidator = {
  bodySchema: z
    .object({
      id: z
        .string()
        .min(2)
        .max(64)
        .regex(/^[a-zA-Z0-9_]+$/)
        .describe("Letters, numbers and underscores only"),
      ...roleFields,
    })
    .strict(),
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: roleResponse,
  summary: "Create a custom role",
  description: customRolesGate,
  operationId: "postRole",
  tags: ["roles"],
  method: "post" as const,
  path: "/roles",
  exampleRequest: {
    body: {
      id: "flagEditor",
      description: "Edit Feature Flags, read everything else",
      policies: ["ReadData" as const, "FeaturesFullAccess" as const],
    },
  },
};

export const putRoleValidator = {
  bodySchema: z.object(roleFields).partial().strict(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: roleResponse,
  summary: "Update a custom role",
  description: `${customRolesGate} Supplied fields replace the stored ones.`,
  operationId: "putRole",
  tags: ["roles"],
  method: "put" as const,
  path: "/roles/:id",
};

export const deleteRoleValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z.object({ deletedId: z.string() }).strict(),
  summary: "Delete a custom role",
  description: `${customRolesGate} A role still used by a member, invite, team, API key or the default role can't be deleted.`,
  operationId: "deleteRole",
  tags: ["roles"],
  method: "delete" as const,
  path: "/roles/:id",
};

export const postRoleActivateValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: roleResponse,
  summary: "Reactivate a deactivated role",
  description: customRolesGate,
  operationId: "postRoleActivate",
  tags: ["roles"],
  method: "post" as const,
  path: "/roles/:id/activate",
};

export const postRoleDeactivateValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: roleResponse,
  summary: "Deactivate a role",
  description: `${customRolesGate} Works for built-in roles too.`,
  operationId: "postRoleDeactivate",
  tags: ["roles"],
  method: "post" as const,
  path: "/roles/:id/deactivate",
};
