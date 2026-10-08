import {
  EventUserOAuthApp,
  OAuthGrantInterface,
  OrgOAuthClientInterface,
} from "shared/validators";
import {
  MemberRoleWithProjects,
  OrganizationInterface,
} from "shared/types/organization";
import { isOAuthClientAllowed } from "shared/util";
import { OrgOAuthClientModel } from "back-end/src/models/OrgOAuthClientModel";
import { getOAuthClientById } from "back-end/src/models/GlobalOAuthClientModel";

export interface OAuthAccess {
  grantId: string;
  // The app's and the member's limits, read live so a change applies on the next request.
  limits: MemberRoleWithProjects[];
  app: EventUserOAuthApp;
}

/** Checked per request, so turning delegation off or rotating the secret ends delegated tokens in the same write. */
export function isDelegatedTokenCurrent(
  app: Pick<
    OrgOAuthClientInterface,
    "allowDelegation" | "clientSecretHash"
  > | null,
  mintedWithSecretHash: string,
): boolean {
  return (
    !!app?.allowDelegation && app.clientSecretHash === mintedWithSecretHash
  );
}

/**
 * What an active grant lets its client do in this org, for a live token or work
 * it armed. Throws once the client, the org's policy or delegation stops allowing it.
 */
export async function resolveOAuthAccess(
  org: OrganizationInterface,
  grant: Pick<OAuthGrantInterface, "id" | "clientId" | "permissionLimit">,
  delegatedSecretHash: string | null = null,
): Promise<OAuthAccess> {
  const app = await OrgOAuthClientModel.dangerousFindById(grant.clientId);
  const publicClient = app ? null : await getOAuthClientById(grant.clientId);
  if (app ? app.organization !== org.id : !publicClient) {
    throw new Error("This OAuth application no longer exists");
  }
  if (!isOAuthClientAllowed(org, app?.organization ?? null)) {
    throw new Error("This organization does not allow this OAuth application");
  }
  if (
    delegatedSecretHash &&
    !isDelegatedTokenCurrent(app, delegatedSecretHash)
  ) {
    throw new Error("This application can no longer act on behalf of members");
  }
  return {
    grantId: grant.id,
    limits: [app?.permissionLimit, grant.permissionLimit].filter(
      (limit): limit is MemberRoleWithProjects => !!limit,
    ),
    app: {
      id: grant.clientId,
      name: app?.clientName || publicClient?.clientName || grant.clientId,
      ...(delegatedSecretHash && { delegated: true }),
    },
  };
}
