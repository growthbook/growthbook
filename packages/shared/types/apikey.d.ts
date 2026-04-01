import { z } from "zod";
import {
  apiKeySchema,
  secretApiKey,
  secretApiKeyRedacted,
} from "shared/validators";

export type ApiKeyInterface = z.infer<typeof apiKeySchema>;
// For typecasting after verifying that the key has a role
export type ApiKeyWithRole = ApiKeyInterface & { role: string };

export type SecretApiKey = z.infer<typeof secretApiKey>;

export type SecretApiKeyRedacted = z.infer<typeof secretApiKeyRedacted>;
