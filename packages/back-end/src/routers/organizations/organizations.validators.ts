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
  // PATs only (type "user"): cap the token at this role and the scoping fields.
  scopedRole: z.string().optional(),
  description: z.string().optional(),
  limitAccessByEnvironment: z.boolean().optional(),
  environments: z.array(z.string()).optional(),
  projectRoles: z.array(projectMemberRoleValidator).optional(),
  additionalRoles: z.array(roleRuleValidator).optional(),
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
  projectRoles: z.array(projectMemberRoleValidator).optional(),
  additionalRoles: z.array(roleRuleValidator).optional(),
  // Omitted leaves the expiry unchanged; null removes it where the policy allows.
  expiresAt: z.string().nullable().optional(),
});

export const putApiKeyDisabledValidator = z.strictObject({
  disabled: z.boolean(),
});
