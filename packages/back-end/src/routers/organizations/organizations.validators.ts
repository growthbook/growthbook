import { z } from "zod";

const roleRuleValidator = z
  .object({
    role: z.string(),
    limitAccessByEnvironment: z.boolean(),
    environments: z.array(z.string()),
  })
  .strict();

const memberRoleInfoValidator = roleRuleValidator
  .extend({
    additionalRoles: z.array(roleRuleValidator).optional(),
  })
  .strict();

const projectMemberRoleValidator = memberRoleInfoValidator
  .extend({
    project: z.string(),
  })
  .strict();

const memberRoleWithProjectsValidator = memberRoleInfoValidator
  .extend({
    projectRoles: z.array(projectMemberRoleValidator).optional(),
  })
  .strict();

export const putDefaultRoleValidator = z
  .object({
    defaultRole: memberRoleWithProjectsValidator,
  })
  .strict();

export const putMemberProjectRoleValidator = z
  .object({
    projectRole: projectMemberRoleValidator,
  })
  .strict();

export const postApiKeyValidator = z.strictObject({
  type: z.string(),
  description: z.string().optional(),
  limitAccessByEnvironment: z.boolean().optional(),
  environments: z.array(z.string()).optional(),
  projectRoles: z.array(projectMemberRoleValidator).optional(),
  additionalRoles: z.array(roleRuleValidator).optional(),
  // ISO string; null or absent means no expiration, subject to the org policy.
  expiresAt: z.string().nullable().optional(),
});

export const putApiKeyValidator = z.strictObject({
  role: z.string(),
  description: z.string().optional(),
  limitAccessByEnvironment: z.boolean().optional(),
  environments: z.array(z.string()).optional(),
  projectRoles: z.array(projectMemberRoleValidator).optional(),
  additionalRoles: z.array(roleRuleValidator).optional(),
});

export const putApiKeyDisabledValidator = z.strictObject({
  disabled: z.boolean(),
});
