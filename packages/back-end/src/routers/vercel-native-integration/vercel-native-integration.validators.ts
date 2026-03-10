import { z } from "zod";

// This is only the things that look interesting.
export const userAuthenticationValidator = z.object({
  payload: z.object({
    installation_id: z.string(),
    account_id: z.string(),
    user_id: z.string(),
    user_role: z.string(),
    user_email: z.string(),
  }),
});

// This is only the things that look interesting.
export const systemAuthenticationValidator = z.object({
  payload: z.object({
    installation_id: z.string().optional(),
    account_id: z.string().optional(),
  }),
});

export const upsertInstallationPayloadValidator = z.object({
  scopes: z.array(z.string()).min(1),
  acceptedPolicies: z.record(z.string(), z.unknown()),
  credentials: z.object({
    access_token: z.string(),
    token_type: z.string(),
  }),
  account: z.object({
    name: z.string().optional(),
    url: z.string().url(),
    contact: z.object({
      email: z.string(),
      name: z.string().optional(),
    }),
  }),
});

export type UpsertInstallationPayload = z.infer<
  typeof upsertInstallationPayloadValidator
>;

export const updateInstallationValidator = z.object({
  billingPlanId: z.string().optional(),
});

export type UpdateInstallation = z.infer<typeof updateInstallationValidator>;

export const deleteInstallationPayloadValidator = z
  .object({
    cascadeResourceDeletion: z.boolean().optional(),
  })
  .strict();

export type DeleteInstallationPayload = z.infer<
  typeof deleteInstallationPayloadValidator
>;

export const billingPlanValidator = z.object({
  cost: z.string().optional(),
  description: z.string(),
  details: z
    .array(
      z.object({
        label: z.string(),
        value: z.string().optional(),
      }),
    )
    .optional(),
  disabled: z.boolean().optional(),
  effectiveDate: z
    .string()
    .datetime({ message: "Invalid datetime string!" })
    .optional(),
  highlightedDetails: z
    .array(
      z.object({
        label: z.string(),
        value: z.string().optional(),
      }),
    )
    .optional(),
  id: z.string(),
  maximumAmount: z.string().optional(),
  maximumAmountAutoPurchasePerPeriod: z.string().optional(),
  minimumAmount: z.string().optional(),
  name: z.string(),
  paymentMethodRequired: z.boolean().optional(),
  preauthorizationAmount: z.number().optional(),
  scope: z.union([z.literal("installation"), z.literal("resource")]).optional(),
  type: z.union([z.literal("prepayment"), z.literal("subscription")]),
});

export type BillingPlan = z.infer<typeof billingPlanValidator>;

export const provisitionResourceValidator = z.object({
  productId: z.string(),
  name: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  externalId: z.string().optional(),
  billingPlanId: z.string(),
  protocolSettings: z
    .object({
      experimentation: z
        .object({
          edgeConfigId: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

export type ProvisitionResource = z.infer<typeof provisitionResourceValidator>;

const statusValidator = z.union([
  z.literal("ready"),
  z.literal("pending"),
  z.literal("suspended"),
  z.literal("resumed"),
  z.literal("uninstalled"),
  z.literal("error"),
]);

export const resourceValidator = z.object({
  billingPlan: billingPlanValidator.optional(),
  id: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  name: z.string(),
  notification: z
    .object({
      href: z.string().url({ message: "Invalid url" }).optional(),
      level: z.union([
        z.literal("info"),
        z.literal("warn"),
        z.literal("error"),
      ]),
      message: z.string().optional(),
      title: z.string(),
    })
    .optional(),
  productId: z.string(),
  protocolSettings: z
    .object({
      experimentation: z
        .object({
          edgeConfigId: z.string().optional(),
          edgeConfigSyncingEnabled: z.boolean().optional(),
          edgeConfigTokenId: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  secrets: z.array(
    z.object({
      name: z.string(),
      prefix: z.string().optional(),
      value: z.string(),
    }),
  ),
  status: statusValidator,
});

export type Resource = z.infer<typeof resourceValidator>;

export const updateResourceValidator = z.object({
  name: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  billingPlanId: z.string().optional(),
  status: statusValidator.optional(),
  protocolSettings: z
    .object({
      experimentation: z
        .object({
          edgeConfigId: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

export type UpdateResource = z.infer<typeof updateResourceValidator>;

export const postSSOCodeValidator = z.object({
  code: z.string(),
});
