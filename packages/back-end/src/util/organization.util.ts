import {
  OrganizationInterface,
  UserPermissions,
} from "shared/types/organization";
import { TeamInterface } from "shared/types/team";
import { ApiKeyWithRole } from "shared/types/apikey";
import {
  getRolePermissions,
  hasRequesterOnlyRules,
  intersectUserPermissions,
  splitRequesterOnlyRules,
  unionUserPermissions,
} from "shared/permissions";
import { SUPERADMIN_DEFAULT_ROLE } from "./secrets";

export function getEnvironmentIdsFromOrg(org: OrganizationInterface): string[] {
  return getEnvironments(org).map((e) => e.id);
}

export function getEnvironments(org: OrganizationInterface) {
  if (!org.settings?.environments || !org.settings?.environments?.length) {
    return [
      {
        id: "dev",
        description: "",
        toggleOnList: true,
      },
      {
        id: "production",
        description: "",
        toggleOnList: true,
      },
    ];
  }
  return org.settings.environments;
}

export function getUserPermissions(
  user: { id: string; superAdmin?: boolean },
  org: OrganizationInterface,
  teams: TeamInterface[],
  restrictedProjects?: string[],
): UserPermissions {
  const memberInfo = org.members.find((m) => m.id === user.id);

  // If the user is a super admin, fall back to a default role if they aren't in the org
  if (!memberInfo && user.superAdmin && SUPERADMIN_DEFAULT_ROLE) {
    return getRolePermissions(
      {
        role: SUPERADMIN_DEFAULT_ROLE,
        limitAccessByEnvironment: false,
        environments: [],
      },
      org,
      teams,
    );
  }

  if (!memberInfo) {
    throw new Error("User is not a member of this organization");
  }

  return getRolePermissions(
    memberInfo,
    org,
    teams,
    // Super admins bypass access-restricted projects
    user.superAdmin ? undefined : restrictedProjects,
  );
}

// What an org key may do for one request when its requester can extend it:
// with `extendWithRequester`, everything the named member may do on top of the
// key's role; otherwise the rules that always apply, plus the requester-only
// rules as far as the member has the same permissions. Undefined when the
// key's own role applies.
export function getKeyPermissionsForRequest({
  apiKey,
  requesterId,
  org,
  teams,
  restrictedProjects,
}: {
  apiKey: ApiKeyWithRole;
  requesterId: string | null;
  org: OrganizationInterface;
  teams: TeamInterface[];
  restrictedProjects: string[];
}): UserPermissions | undefined {
  if (apiKey.extendWithRequester) {
    if (!requesterId) return undefined;
    return unionUserPermissions(
      getRolePermissions(apiKey, org, teams, restrictedProjects),
      getUserPermissions({ id: requesterId }, org, teams, restrictedProjects),
      org,
    );
  }
  if (!hasRequesterOnlyRules(apiKey)) return undefined;
  const { always, requesterOnly } = splitRequesterOnlyRules(apiKey);
  const alwaysPermissions = getRolePermissions(
    always,
    org,
    teams,
    restrictedProjects,
  );
  if (!requesterId) return alwaysPermissions;
  return unionUserPermissions(
    alwaysPermissions,
    intersectUserPermissions(
      getRolePermissions(requesterOnly, org, teams, restrictedProjects),
      getUserPermissions({ id: requesterId }, org, teams, restrictedProjects),
    ),
    org,
  );
}
