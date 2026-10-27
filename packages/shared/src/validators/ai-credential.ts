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

// A model id the built-in list doesn't know, typically one a gateway exposes.
// Everything we can't safely default is the admin's to state.
export const aiCustomModelSchema = z
  .object({
    provider: z.enum(AI_PROVIDERS),
    id: z.string().trim().min(1).max(256),
    // OpenAI only. Many gateways implement Chat Completions but not Responses.
    apiFormat: z.enum(["responses", "chat"]).optional(),
    vision: z.boolean(),
  })
  .strict();

export type AICustomModel = z.infer<typeof aiCustomModelSchema>;

export const aiCustomModelsValidator = z
  .array(aiCustomModelSchema)
  .max(100)
  .refine(
    (models) =>
      new Set(models.map((m) => `${m.provider}:${m.id}`)).size ===
      models.length,
    { message: "Each provider can only list a model ID once." },
  );

export type AICredentialInterface = z.infer<typeof aiCredentialSchema>;

export type AICredentialFrontEndInterface = Omit<
  AICredentialInterface,
  "encryptedKey"
>;
