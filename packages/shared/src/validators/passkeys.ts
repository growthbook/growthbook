import { z } from "zod";

// AuthenticatorTransportFuture from the WebAuthn spec
export const passkeyTransportValidator = z.enum([
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb",
]);
export type PasskeyTransport = z.infer<typeof passkeyTransportValidator>;

export const passkeyValidator = z
  .object({
    id: z.string(),
    userId: z.string(),
    // base64url, as WebAuthn sends it
    credentialId: z.string(),
    // base64url-encoded COSE public key
    publicKey: z.string(),
    counter: z.number().int().nonnegative(),
    transports: z.array(passkeyTransportValidator),
    // "multiDevice" passkeys sync between devices (e.g. iCloud Keychain)
    deviceType: z.enum(["singleDevice", "multiDevice"]),
    backedUp: z.boolean(),
    name: z.string(),
    dateCreated: z.date(),
    lastUsed: z.date().nullable(),
  })
  .strict();
export type PasskeyInterface = z.infer<typeof passkeyValidator>;
