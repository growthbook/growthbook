import {
  OrganizationInterface,
  UserPermissions,
} from "shared/types/organization";
import { TeamInterface } from "shared/types/team";
import { ApiKeyInterface } from "shared/types/apikey";
import {
  assumesRequesterRole,
  getRolePermissions,
  intersectUserPermissions,
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

// A scoped PAT can never exceed its user: it gets what both the user and the key allow.
export function getPersonalAccessTokenPermissions(
  apiKey: ApiKeyInterface,
  user: { id: string; superAdmin?: boolean },
  org: OrganizationInterface,
  teams: TeamInterface[],
  restrictedProjects?: string[],
): UserPermissions {
  const userPermissions = getUserPermissions(
    user,
    org,
    teams,
    restrictedProjects,
  );
  if (!apiKey.scoped) return userPermissions;
  return intersectUserPermissions(
    userPermissions,
    getRolePermissions(
      { ...apiKey, role: apiKey.role ?? "noaccess" },
      org,
      teams,
      restrictedProjects,
    ),
  );
}

// An org key that assumes the role of the member it names gets only what both
// its role and that member allow: the unverified header can narrow a key,
// never widen it. Undefined when the key's own role applies, and for PATs.
export function getKeyPermissionsForRequest({
  apiKey,
  requesterId,
  org,
  teams,
  restrictedProjects,
}: {
  apiKey: ApiKeyInterface;
  requesterId: string | null;
  org: OrganizationInterface;
  teams: TeamInterface[];
  restrictedProjects: string[];
}): UserPermissions | undefined {
  if (apiKey.userId || !requesterId || !assumesRequesterRole(apiKey)) {
    return undefined;
  }
  return intersectUserPermissions(
    getRolePermissions(
      { ...apiKey, role: apiKey.role ?? "noaccess" },
      org,
      teams,
      restrictedProjects,
    ),
    getUserPermissions({ id: requesterId }, org, teams, restrictedProjects),
  );
}
