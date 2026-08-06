import { z } from "zod";
import { AI_PROVIDERS } from "shared/ai";
import { createBaseSchemaWithPrimaryKey } from "./base-model";

// A bring-your-own-key AI credential, one row per (organization, provider).
// Multiple providers per org, because different surfaces need different ones:
// chat can be Anthropic while embeddings are OpenAI and Visual Editor images are
// Google-only. Holds ciphertext only — services/aiCredentials.ts does the AES.
export const aiCredentialSchema = createBaseSchemaWithPrimaryKey({
  organization: z.string(),
  provider: z.enum(AI_PROVIDERS),
}).safeExtend({
  // AES-encrypted (crypto-js + ENCRYPTION_KEY) provider API key.
  encryptedKey: z.string(),
  // Last 4 characters of the plaintext key, for masked display only.
  last4: z.string(),
  // Email of the user who last set the key, for the "set by" line in settings.
  updatedByEmail: z.string(),
});

export type AICredentialInterface = z.infer<typeof aiCredentialSchema>;

// The only shape that may cross the network boundary. `encryptedKey` is stripped
// even though it's ciphertext — a browser has no reason to ever hold it.
export type AICredentialFrontEndInterface = Omit<
  AICredentialInterface,
  "encryptedKey"
>;
