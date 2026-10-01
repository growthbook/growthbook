import {
  OAuthAccessPolicy,
  OrganizationInterface,
  OrganizationSettings,
} from "shared/types/organization";

// Cosmetic only: nothing trusts the prefix, see isOAuthClientAllowed.
export const ORG_OAUTH_APP_CLIENT_ID_PREFIX = "gbapp_";

// URL.hostname keeps IPv6 brackets, so "[::1]" is the form to match.
export function isLoopbackHost(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

// Unset falls back to the PAT kill switch, which covered OAuth tokens before this
// setting existed; upgradeOrganizationDoc pins the result on the org doc.
export function getOAuthAccessPolicy(
  settings: OrganizationSettings | undefined,
): OAuthAccessPolicy {
  return (
    settings?.oauthAccess ??
    (settings?.disablePersonalAccessTokens ? "none" : "any")
  );
}

// `officialClientForOrg` is the org that registered the client (null for public DCR
// clients); it comes from the client doc at issuance and is stamped on the token.
export function isOAuthClientAllowed(
  org: Pick<OrganizationInterface, "id" | "settings">,
  officialClientForOrg: string | null,
): boolean {
  const policy = getOAuthAccessPolicy(org.settings);
  if (policy === "none") return false;
  if (policy === "org-apps") return officialClientForOrg === org.id;
  return true;
}
