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
// X-GrowthBook-Requested-By has the same permissions.
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
  // PATs only (type "user"): cap the token at this role and the scoping fields.
  scopedRole: z.string().optional(),
  description: z.string().optional(),
  limitAccessByEnvironment: z.boolean().optional(),
  environments: z.array(z.string()).optional(),
  projectRoles: z.array(apiKeyProjectRoleValidator).optional(),
  additionalRoles: z.array(apiKeyRoleRuleValidator).optional(),
  requesterOnly: z.boolean().optional(),
  requireRequestedBy: z.boolean().optional(),
  extendWithRequester: z.boolean().optional(),
  // ISO string; null or absent means no expiration, subject to the org policy.
  expiresAt: z.string().nullable().optional(),
});

export const putApiKeyValidator = z.strictObject({
  // Org keys only
  role: z.string().optional(),
  // PATs only: same meaning as on create; omit to make the token unscoped.
  scopedRole: z.string().optional(),
  description: z.string().optional(),
  limitAccessByEnvironment: z.boolean().optional(),
  environments: z.array(z.string()).optional(),
  projectRoles: z.array(apiKeyProjectRoleValidator).optional(),
  additionalRoles: z.array(apiKeyRoleRuleValidator).optional(),
  // Org keys only; an omitted flag keeps its saved value.
  requesterOnly: z.boolean().optional(),
  requireRequestedBy: z.boolean().optional(),
  extendWithRequester: z.boolean().optional(),
  // Omitted leaves the expiry unchanged; null removes it where the policy allows.
  expiresAt: z.string().nullable().optional(),
});

export const putApiKeyDisabledValidator = z.strictObject({
  disabled: z.boolean(),
});
