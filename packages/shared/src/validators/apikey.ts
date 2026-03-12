import { z } from "zod";
import { createBaseSchemaWithPrimaryKey } from "./base-model";

export const apiKeySchema = createBaseSchemaWithPrimaryKey({
  key: z.string(),
}).safeExtend({
  id: z.string().optional(),
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
  .omit({ id: true, secret: true, environment: true, project: true })
  .safeExtend({ id: z.string(), secret: z.literal(true) });

export const secretApiKeyRedacted = secretApiKey.omit({ key: true });
