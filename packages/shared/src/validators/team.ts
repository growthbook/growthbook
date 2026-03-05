import { z } from "zod";
import { apiBaseSchema, baseSchema } from "./base-model";
import { managedByValidator } from "./managed-by";
import { projectMemberRole } from "./organization";

export const teamSchema = baseSchema.safeExtend({
  name: z.string(),
  createdBy: z.string(),
  description: z.string(),
  role: z.string(),
  limitAccessByEnvironment: z.boolean(),
  environments: z.array(z.string()),
  projectRoles: z.array(projectMemberRole).optional(),
  members: z.array(z.string()).optional(),
  managedByIdp: z.boolean(),
  managedBy: managedByValidator.optional(),
  defaultProject: z.string().optional(),
});

export const apiTeamValidator = apiBaseSchema.safeExtend({
  name: z.string(),
  createdBy: z.string(),
  description: z.string(),
  role: z.string(),
  limitAccessByEnvironment: z.boolean(),
  environments: z.array(z.string()),
  projectRoles: z.array(projectMemberRole).optional(),
  members: z.array(z.string()).readonly(),
  managedByIdp: z.boolean(),
  managedBy: managedByValidator.optional(),
  defaultProject: z.string().optional(),
});

export const apiCreateTeamBody = z.strictObject({
  name: z.string(),
  createdBy: z.string().optional(),
  description: z.string(),
  role: z.string().describe("The global role for members of this team"),
  limitAccessByEnvironment: z.boolean().optional(),
  environments: z
    .array(z.string())
    .optional()
    .describe("An empty array means 'all environments'"),
  projectRoles: z.array(projectMemberRole).optional(),
  managedBy: managedByValidator.optional(),
  defaultProject: z.string().optional(),
});

export const apiUpdateTeamBody = apiCreateTeamBody.partial();

export const apiDeleteTeamValidator = {
  bodySchema: z.never(),
  querySchema: z.strictObject({
    deleteMembers: z
      .string()
      .optional()
      .describe("When 'true', enables deleting a team that contains members"),
  }),
  paramsSchema: z.strictObject({ teamId: z.string() }),
};

export const apiDeleteTeamReturn = z.strictObject({ deletedId: z.string() });
export type ApiDeleteTeamReturn = z.infer<typeof apiDeleteTeamReturn>;

export const apiAddTeamMembersValidator = {
  bodySchema: z.strictObject({ members: z.array(z.string()) }),
  querySchema: z.never(),
  paramsSchema: z.strictObject({ teamId: z.string() }),
};

export const apiRemoveTeamMemberValidator = {
  bodySchema: z.strictObject({ members: z.array(z.string()) }),
  querySchema: z.never(),
  paramsSchema: z.strictObject({ teamId: z.string() }),
};
