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
  members: z.array(z.string()).optional(),
  managedByIdp: z.boolean(),
  managedBy: managedByValidator.optional(),
  defaultProject: z.string().optional(),
});

export const apiCreateTeamBody = z.strictObject({
  name: z.string(),
  createdBy: z.string().optional(),
  description: z.string(),
  role: z.string(),
  limitAccessByEnvironment: z.boolean(),
  environments: z.array(z.string()),
  projectRoles: z.array(projectMemberRole).optional(),
  members: z.array(z.string()).optional(),
  managedBy: managedByValidator.optional(),
  defaultProject: z.string().optional(),
});

export const apiUpdateTeamBody = apiCreateTeamBody.partial();
