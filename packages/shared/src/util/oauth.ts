import {
  OAuthAccessPolicy,
  OrganizationSettings,
} from "shared/types/organization";

export const ORG_OAUTH_APP_CLIENT_ID_PREFIX = "gbapp_";

// Org app IDs are minted server-side with this prefix; DCR can't choose its client_id.
export function isOrgOAuthAppClientId(clientId: string): boolean {
  return clientId.startsWith(ORG_OAUTH_APP_CLIENT_ID_PREFIX);
}

// Unset falls back to the PAT kill switch, which covered OAuth tokens before this setting existed.
export function getOAuthAccessPolicy(
  settings: OrganizationSettings | undefined,
): OAuthAccessPolicy {
  return (
    settings?.oauthAccess ??
    (settings?.disablePersonalAccessTokens ? "none" : "any")
  );
}

export function isOAuthClientAllowed(
  settings: OrganizationSettings | undefined,
  clientId: string,
): boolean {
  const policy = getOAuthAccessPolicy(settings);
  if (policy === "none") return false;
  if (policy === "org-apps") return isOrgOAuthAppClientId(clientId);
  return true;
}
