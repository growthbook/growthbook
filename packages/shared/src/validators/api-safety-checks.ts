import { z } from "zod";

export const STRICT_ENVIRONMENT_CHECKS_LABEL =
  "Require explicit environments and approval on create";

export const apiSafetyCheckCodes = [
  "rule_scope_required",
  "environment_state_required",
  "create_requires_approval",
] as const;

export type ApiSafetyCheckCode = (typeof apiSafetyCheckCodes)[number];

// Enforced while the organization's `strictEnvironmentChecks` setting is on;
// while it is off, a request that fails one succeeds as before and carries a
// notice instead.
export const apiSafetyChecks = {
  rule_scope_required: {
    status: 400,
    description: "A rule sets neither `environments` nor `allEnvironments`",
    detailsSchema: z.object({
      rules: z
        .array(z.number().int())
        .describe("Zero-based indexes of the rules that have no scope."),
    }),
  },
  environment_state_required: {
    status: 400,
    description:
      "A new Feature Flag does not set `enabled` for every environment it can be in",
    detailsSchema: z.object({
      missing: z
        .array(z.string())
        .describe("Environments the request does not set `enabled` for."),
      environments: z
        .array(z.string())
        .describe("Every environment the Feature Flag can be in."),
    }),
  },
  create_requires_approval: {
    status: 422,
    description:
      "A new Feature Flag turns on an environment that requires approval",
    detailsSchema: z.object({
      environments: z
        .array(z.string())
        .describe("Environments that need approval to turn on."),
    }),
  },
} satisfies Record<
  ApiSafetyCheckCode,
  { status: number; description: string; detailsSchema: z.ZodTypeAny }
>;

export const apiNoticeValidator = z
  .object({
    code: z.enum(apiSafetyCheckCodes),
    message: z.string(),
    path: z
      .string()
      .optional()
      .describe("The part of the request body the notice is about."),
  })
  .strict();

export type ApiNotice = z.infer<typeof apiNoticeValidator>;

export const apiNoticesField = z
  .array(apiNoticeValidator)
  .optional()
  .describe(
    `Parts of this request that succeeded only because the organization has not turned on "${STRICT_ENVIRONMENT_CHECKS_LABEL}". Each one is rejected, with the same \`code\`, once it is on. Present only when there is at least one.`,
  );

export function withNotices<T extends z.ZodObject>(schema: T) {
  return schema.extend({ notices: apiNoticesField });
}
