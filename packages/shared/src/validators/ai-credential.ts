import { z } from "zod";
import { AI_PROVIDERS } from "shared/ai";
import { createBaseSchemaWithPrimaryKey } from "./base-model";

export const aiCredentialSchema = createBaseSchemaWithPrimaryKey({
  organization: z.string(),
  provider: z.enum(AI_PROVIDERS),
}).safeExtend({
  encryptedKey: z.string(),
  last4: z.string(),
  // Empty or missing means the provider's own API.
  baseUrl: z.string().optional(),
  updatedByEmail: z.string(),
});

export type AICredentialInterface = z.infer<typeof aiCredentialSchema>;

export type AICredentialFrontEndInterface = Omit<
  AICredentialInterface,
  "encryptedKey"
>;
