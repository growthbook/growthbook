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

// Org API keys only: any rule can apply only as far as the member named in
// X-Requested-By has the same permissions.
const apiKeyRoleRuleValidator = roleRuleValidator
  .extend({ requesterOnly: z.boolean().optional() })
  .strict();

const apiKeyProjectRoleValidator = projectMemberRoleValidator
  .extend({
    requesterOnly: z.boolean().optional(),
    additionalRoles: z.array(apiKeyRoleRuleValidator).optional(),
  })
  .strict();

export const postApiKeyValidator = z.strictObject({
  type: z.string(),
  description: z.string().optional(),
  limitAccessByEnvironment: z.boolean().optional(),
  environments: z.array(z.string()).optional(),
  projectRoles: z.array(apiKeyProjectRoleValidator).optional(),
  additionalRoles: z.array(apiKeyRoleRuleValidator).optional(),
  requesterOnly: z.boolean().optional(),
  requireRequestedBy: z.boolean().optional(),
});

export const putApiKeyValidator = z.strictObject({
  role: z.string(),
  description: z.string().optional(),
  limitAccessByEnvironment: z.boolean().optional(),
  environments: z.array(z.string()).optional(),
  projectRoles: z.array(apiKeyProjectRoleValidator).optional(),
  additionalRoles: z.array(apiKeyRoleRuleValidator).optional(),
  requesterOnly: z.boolean().optional(),
  requireRequestedBy: z.boolean().optional(),
});

export const putApiKeyDisabledValidator = z.strictObject({
  disabled: z.boolean(),
});
