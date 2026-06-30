import { z } from "zod";
import { createBaseSchemaWithPrimaryKey } from "./base-model";

// Per-user Figma OAuth connection. The primary key is (userId,
// organization) so a user has at most one Figma connection per org. The
// access/refresh tokens are AES-encrypted at rest by the service layer
// (see back-end/src/services/figma.ts) — this schema only sees opaque
// ciphertext strings, never the raw tokens.
export const figmaConnectionSchema = createBaseSchemaWithPrimaryKey({
  userId: z.string(),
  organization: z.string(),
}).safeExtend({
  // AES-encrypted (crypto-js + ENCRYPTION_KEY) OAuth tokens.
  accessToken: z.string(),
  refreshToken: z.string(),
  // Epoch milliseconds when the access token expires.
  expiresAt: z.number(),
});

export type FigmaConnectionInterface = z.infer<typeof figmaConnectionSchema>;
