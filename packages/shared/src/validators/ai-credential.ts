import { z } from "zod";
import { AI_PROVIDERS } from "shared/ai";
import { createBaseSchemaWithPrimaryKey } from "./base-model";

// A bring-your-own-key AI credential. One row per (organization, provider), so
// an org can hold at most one key per provider — the composite primary key
// gives BaseModel a unique index that enforces that at the DB level. Multiple
// providers are supported per org because different AI surfaces need different
// ones: chat can be Anthropic while embeddings are OpenAI and Visual Editor
// image generation is Google-only.
//
// The key itself is AES-encrypted at rest by the service layer (see
// back-end/src/services/aiCredentials.ts) — this schema only ever holds opaque
// ciphertext, never the raw key. `last4` is stored alongside so the settings UI
// can render a masked key without ever decrypting.
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

// The only shape that may cross the network boundary. `encryptedKey` is
// stripped even though it is ciphertext — there is no reason for a browser to
// ever hold it, and stripping it removes a whole class of accidental leak.
export type AICredentialFrontEndInterface = Omit<
  AICredentialInterface,
  "encryptedKey"
>;
