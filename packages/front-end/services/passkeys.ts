import { WebAuthnError } from "@simplewebauthn/browser";

const WRONG_DOMAIN =
  "Passkeys aren't set up for this domain. Ask your admin to check WEBAUTHN_RP_ID.";
// GrowthBook asks for a passkey that unlocks with a PIN or biometrics and
// can be used without typing an email first
const DEVICE_CANT_DO_IT =
  "This device can't create the kind of passkey GrowthBook needs. Try another device or your password manager.";

const messages: Partial<Record<WebAuthnError["code"], string>> = {
  ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED:
    "This device already has a passkey for your account.",
  ERROR_INVALID_RP_ID: WRONG_DOMAIN,
  ERROR_INVALID_DOMAIN: WRONG_DOMAIN,
  ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT:
    DEVICE_CANT_DO_IT,
  ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT: DEVICE_CANT_DO_IT,
};

// Explains the browser errors a user or admin can do something about. Returns
// null for anything else, including the user cancelling, so callers can fall
// back to their own message.
export function describeWebAuthnError(e: unknown): string | null {
  if (!(e instanceof WebAuthnError)) return null;
  return messages[e.code] ?? null;
}
