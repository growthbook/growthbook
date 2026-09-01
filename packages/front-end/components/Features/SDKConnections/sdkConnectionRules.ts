import { SDKLanguage } from "shared/types/sdk-connection";

/**
 * Payload security rules shared by the create and edit surfaces, mirroring
 * `SDKConnectionForm` so the split modals can't drift from the full form.
 */

/**
 * Next.js connections must serve plain text — the framework's own caching layer
 * can't read a ciphered or remotely-evaluated payload. Every other language
 * supports encryption and secure attributes.
 */
export function shouldShowPayloadSecurity(
  languages: SDKLanguage[] | undefined,
): boolean {
  return !(languages ?? []).includes("nextjs");
}
