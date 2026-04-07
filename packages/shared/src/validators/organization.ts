import { z } from "zod";

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
