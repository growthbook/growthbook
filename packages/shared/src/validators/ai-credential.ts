import { z } from "zod";
import { AI_PROVIDERS } from "shared/ai";
import { createBaseSchemaWithPrimaryKey } from "./base-model";

export const aiCredentialSchema = createBaseSchemaWithPrimaryKey({
  organization: z.string(),
  provider: z.enum(AI_PROVIDERS),
}).safeExtend({
  encryptedKey: z.string(),
  last4: z.string(),
  updatedByEmail: z.string(),
});

// A model id the built-in list doesn't know, typically one a gateway exposes.
// Self-hosted admins list these in the AI_CUSTOM_MODELS env var.
export const aiCustomModelSchema = z
  .object({
    provider: z.enum(AI_PROVIDERS),
    id: z.string().trim().min(1).max(256),
    // OpenAI only. Many gateways implement Chat Completions but not Responses.
    apiFormat: z.enum(["responses", "chat"]).optional(),
    vision: z.boolean().optional(),
  })
  .strict()
  .refine((m) => (m.provider === "openai") === !!m.apiFormat, {
    message:
      "OpenAI models need an API format, and other providers can't have one.",
  });

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
