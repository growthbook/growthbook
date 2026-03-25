import { z } from "zod";
import {
  apiKeySchema,
  secretApiKey,
  secretApiKeyRedacted,
} from "shared/validators";

export type ApiKeyInterface = z.infer<typeof apiKeySchema>;

export type SecretApiKey = z.infer<typeof secretApiKey>;

export type SecretApiKeyRedacted = z.infer<typeof secretApiKeyRedacted>;
