import {
  MemberRoleWithProjects,
  OrganizationInterface,
  UserPermissions,
} from "shared/types/organization";
import { TeamInterface } from "shared/types/team";
import { ApiKeyInterface } from "shared/types/apikey";
import {
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

// A token never exceeds its user: it gets what the user and every limit on it
// allow. Limits are a scoped PAT's own role, or an OAuth app's and its grant's.
export function getPersonalAccessTokenPermissions(
  apiKey: ApiKeyInterface | undefined,
  user: { id: string; superAdmin?: boolean },
  org: OrganizationInterface,
  teams: TeamInterface[],
  restrictedProjects?: string[],
  oauthLimits: MemberRoleWithProjects[] = [],
): UserPermissions {
  const limits = apiKey?.scoped
    ? [{ ...apiKey, role: apiKey.role ?? "noaccess" }, ...oauthLimits]
    : oauthLimits;
  return limits.reduce(
    (permissions, limit) =>
      intersectUserPermissions(
        permissions,
        getRolePermissions(limit, org, teams, restrictedProjects),
      ),
    getUserPermissions(user, org, teams, restrictedProjects),
  );
}
