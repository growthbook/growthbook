import { z } from "zod";
import { baseSchema } from "./base-model";

export const apiKeySchema = baseSchema.safeExtend({
  // TODO: deal with optional ID?
  key: z.string(),
  environment: z.string().optional(),
  project: z.string().optional(),
  description: z.string().optional(),
  userId: z.string().optional(),
  role: z.string().optional(),
  encryptSDK: z.boolean().optional(),
  encryptionKey: z.string().optional(),
  secret: z.boolean().optional(),
});

export const secretApiKey = apiKeySchema
  .omit({ secret: true, environment: true, project: true })
  .safeExtend({ secret: z.literal(true) });

export const secretApiKeyRedacted = secretApiKey.omit({ key: true });
