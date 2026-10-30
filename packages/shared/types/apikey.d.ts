import { z } from "zod";
import { apiKeySchema } from "shared/validators";

export type ApiKeyInterface = z.infer<typeof apiKeySchema>;
// For typecasting after verifying that the key has a role
export type ApiKeyWithRole = ApiKeyInterface & { role: string };
