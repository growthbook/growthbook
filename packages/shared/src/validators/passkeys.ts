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

// What the account page shows; never the key material
export const passkeySummaryValidator = passkeyValidator.pick({
  id: true,
  name: true,
  deviceType: true,
  backedUp: true,
  dateCreated: true,
  lastUsed: true,
});
export type PasskeySummary = z.infer<typeof passkeySummaryValidator>;

export const PASSKEY_NAME_MAX_LENGTH = 64;
export const passkeyNameValidator = z
  .string()
  .trim()
  .min(1)
  .max(PASSKEY_NAME_MAX_LENGTH);

// The shape @simplewebauthn/browser sends back, minus the part that differs
// between adding a passkey and signing in. The server library does the actual
// cryptographic checks.
const passkeyResponseBaseValidator = z.object({
  id: z.string(),
  rawId: z.string(),
  authenticatorAttachment: z.enum(["cross-platform", "platform"]).optional(),
  clientExtensionResults: z.object({
    appid: z.boolean().optional(),
    credProps: z.object({ rk: z.boolean().optional() }).optional(),
    hmacCreateSecret: z.boolean().optional(),
  }),
  type: z.literal("public-key"),
});

export const passkeyRegistrationResponseValidator =
  passkeyResponseBaseValidator.extend({
    response: z.object({
      clientDataJSON: z.string(),
      attestationObject: z.string(),
      authenticatorData: z.string().optional(),
      transports: z.array(z.string()).optional(),
      publicKeyAlgorithm: z.number().optional(),
      publicKey: z.string().optional(),
    }),
  });
export type PasskeyRegistrationResponse = z.infer<
  typeof passkeyRegistrationResponseValidator
>;

export const startPasskeyRegistrationBodyValidator = z.strictObject({
  password: z.string(),
});
export type StartPasskeyRegistrationBody = z.infer<
  typeof startPasskeyRegistrationBodyValidator
>;

export const finishPasskeyRegistrationBodyValidator = z.strictObject({
  name: passkeyNameValidator,
  response: passkeyRegistrationResponseValidator,
});
export type FinishPasskeyRegistrationBody = z.infer<
  typeof finishPasskeyRegistrationBodyValidator
>;

export const renamePasskeyBodyValidator = z.strictObject({
  name: passkeyNameValidator,
});
export type RenamePasskeyBody = z.infer<typeof renamePasskeyBodyValidator>;

export const passkeyAuthenticationResponseValidator =
  passkeyResponseBaseValidator.extend({
    response: z.object({
      clientDataJSON: z.string(),
      authenticatorData: z.string(),
      signature: z.string(),
      userHandle: z.string().optional(),
    }),
  });
export type PasskeyAuthenticationResponse = z.infer<
  typeof passkeyAuthenticationResponseValidator
>;

export const finishPasskeySignInBodyValidator = z.strictObject({
  response: passkeyAuthenticationResponseValidator,
});
export type FinishPasskeySignInBody = z.infer<
  typeof finishPasskeySignInBodyValidator
>;
