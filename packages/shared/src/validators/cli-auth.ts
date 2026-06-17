import { z } from "zod";

export const cliAuthRequestStatus = z.enum([
  "pending",
  "approved",
  "exchanged",
  "expired",
]);
export type CliAuthRequestStatus = z.infer<typeof cliAuthRequestStatus>;

const safeName = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9 ._\-/]+$/, "Invalid characters");

export const cliAuthInitBody = z
  .object({
    clientName: safeName,
    codeChallenge: z.string().min(43).max(128),
    codeChallengeMethod: z.literal("S256"),
    suggestedOrgName: z.string().min(3).max(100).optional(),
  })
  .strict();
export type CliAuthInitBody = z.infer<typeof cliAuthInitBody>;

export const cliAuthInitResponse = z
  .object({
    requestId: z.string(),
    expiresAt: z.string(),
    approveUrl: z.string(),
  })
  .strict();
export type CliAuthInitResponse = z.infer<typeof cliAuthInitResponse>;

export const cliAuthApproveBody = z
  .object({
    requestId: z.string().min(1),
    organization: z.string().min(1),
    loopbackPort: z.number().int().min(1).max(65535),
  })
  .strict();
export type CliAuthApproveBody = z.infer<typeof cliAuthApproveBody>;

export const cliAuthApproveResponse = z
  .object({
    exchangeCode: z.string(),
    redirectUri: z.string(),
  })
  .strict();
export type CliAuthApproveResponse = z.infer<typeof cliAuthApproveResponse>;

export const cliAuthExchangeBody = z
  .object({
    requestId: z.string().min(1),
    exchangeCode: z.string().min(1),
    codeVerifier: z.string().min(43).max(128),
  })
  .strict();
export type CliAuthExchangeBody = z.infer<typeof cliAuthExchangeBody>;

export const cliAuthExchangeResponse = z
  .object({
    apiKey: z.string(),
    organization: z.string(),
    userEmail: z.string(),
    keyId: z.string(),
  })
  .strict();
export type CliAuthExchangeResponse = z.infer<typeof cliAuthExchangeResponse>;

export const cliAuthRequestDetails = z
  .object({
    requestId: z.string(),
    clientName: z.string(),
    suggestedOrgName: z.string().optional(),
    status: cliAuthRequestStatus,
    expiresAt: z.string(),
  })
  .strict();
export type CliAuthRequestDetails = z.infer<typeof cliAuthRequestDetails>;
