import { cloneDeep } from "lodash";
import {
  ALL_PERMISSIONS,
  ENV_SCOPED_PERMISSIONS,
  getPermissionsObjectByPolicies,
  getRoleById,
  roleSupportsEnvLimit,
} from "shared/permissions";
import {
  OrganizationInterface,
  Permission,
  PermissionsObject,
  ProjectMemberRole,
  UserPermission,
  UserPermissions,
} from "back-end/types/organization";
import { TeamInterface } from "back-end/types/team";
import { SUPERADMIN_DEFAULT_ROLE } from "./secrets";

function hasEnvScopedPermissions(userPermission: PermissionsObject): boolean {
  const envLimitedPermissions: Permission[] = ENV_SCOPED_PERMISSIONS.map(
    (permission) => permission,
  );

  for (const permission of envLimitedPermissions) {
    if (userPermission[permission]) {
      return true;
    }
  }
  return false;
}

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

export function roleToPermissionMap(
  roleId: string,
  org: OrganizationInterface,
): PermissionsObject {
  const role = getRoleById(roleId || "readonly", org);
  const policies = role?.policies || [];
  return getPermissionsObjectByPolicies(policies);
}

function isValidPermission(permission: string): permission is Permission {
  return ALL_PERMISSIONS.includes(permission as Permission);
}

function mergePermissions(
  existingPermissions: PermissionsObject,
  newPermissions: PermissionsObject,
): PermissionsObject {
  const updatedPermissions: PermissionsObject = { ...existingPermissions };

  for (const permission in newPermissions) {
    if (isValidPermission(permission) && newPermissions[permission] === true) {
      updatedPermissions[permission] = true;
    }
  }

  return updatedPermissions;
}

function mergeEnvironmentLimits(
  existingPermissions: UserPermission,
  newPermissions: UserPermission,
  org: OrganizationInterface,
): UserPermission {
  const existingRoleSupportsEnvLimits = hasEnvScopedPermissions(
    existingPermissions.permissions,
  );
  const newRoleSupportsEnvLimits = hasEnvScopedPermissions(
    newPermissions.permissions,
  );

  if (!existingRoleSupportsEnvLimits && !newRoleSupportsEnvLimits) {
    // Neither role supports env limits, so we can skip logic below
    return existingPermissions;
  }

  const updatedPermissions = cloneDeep(existingPermissions);

  if (
    // If the existingRole & newRole can be limited by environment
    existingRoleSupportsEnvLimits &&
    newRoleSupportsEnvLimits
  ) {
    if (
      // and if limitAccessByEnvironment is the same for new and existing roles, we just concat the envs arrays
      updatedPermissions.limitAccessByEnvironment ===
      newPermissions.limitAccessByEnvironment
    ) {
      updatedPermissions.environments = [
        ...new Set(
          updatedPermissions.environments.concat(newPermissions.environments),
        ),
      ];
      updatedPermissions.limitAccessByEnvironment = getLimitAccessByEnvironment(
        updatedPermissions.environments,
        updatedPermissions.limitAccessByEnvironment,
        org,
      );
    } else {
      // otherwise, 1 role doesn't have limited access by environment, so it overrides the other
      updatedPermissions.limitAccessByEnvironment = false;
      updatedPermissions.environments = [];
    }
  } else {
    // Only override existing role's env limits if the existing role doesn't support env limits, and the newRole does
    if (!existingRoleSupportsEnvLimits && newRoleSupportsEnvLimits) {
      updatedPermissions.limitAccessByEnvironment = getLimitAccessByEnvironment(
        newPermissions.environments,
        newPermissions.limitAccessByEnvironment,
        org,
      );

      updatedPermissions.environments = newPermissions.environments;
    }
  }
  return updatedPermissions;
}

function mergeUserPermissionObj(
  userPermission1: UserPermission,
  userPermission2: UserPermission,
  org: OrganizationInterface,
): UserPermission {
  let updatedUserPermissionObj = userPermission1;

  updatedUserPermissionObj = mergeEnvironmentLimits(
    updatedUserPermissionObj,
    userPermission2,
    org,
  );
  updatedUserPermissionObj.permissions = mergePermissions(
    updatedUserPermissionObj.permissions,
    userPermission2.permissions,
  );

  return updatedUserPermissionObj;
}

function mergeUserAndTeamPermissions(
  userPermissions: UserPermissions,
  teamPermissions: UserPermissions,
  org: OrganizationInterface,
) {
  // Build a list of all projects
  const allProjects = new Set([
    ...Object.keys(userPermissions.projects),
    ...Object.keys(teamPermissions.projects),
  ]);

  // Loop through that list of projects and merge the user and team permissions
  allProjects.forEach((project) => {
    userPermissions.projects[project] = mergeUserPermissionObj(
      userPermissions.projects[project] || {
        limitAccessByEnvironment:
          userPermissions.global.limitAccessByEnvironment,
        environments: userPermissions.global.environments,
        permissions: userPermissions.global.permissions,
      },
      teamPermissions.projects[project] || {
        limitAccessByEnvironment:
          teamPermissions.global.limitAccessByEnvironment,
        environments: teamPermissions.global.environments,
        permissions: teamPermissions.global.permissions,
      },
      org,
    );
  });

  // Merge the global permissions
  userPermissions.global = mergeUserPermissionObj(
    userPermissions.global,
    teamPermissions.global,
    org,
  );
}

function getLimitAccessByEnvironment(
  environments: string[],
  limitAccessByEnvironment: boolean,
  org: OrganizationInterface,
): boolean {
  // If all environments are selected, treat that the same as not limiting by environment
  const validEnvs = org.settings?.environments?.map((e) => e.id) || [];
  if (
    limitAccessByEnvironment &&
    validEnvs.every((e) => environments?.includes(e))
  ) {
    return false;
  }

  return limitAccessByEnvironment;
}

function getUserPermission(
  info: {
    environments?: string[];
    limitAccessByEnvironment?: boolean;
    role: string;
  },
  org: OrganizationInterface,
): UserPermission {
  let limitAccessByEnvironment = !!info.limitAccessByEnvironment;

  // Only some roles can be limited by environment
  // TODO: This will have to change when we support custom roles
  if (limitAccessByEnvironment && !roleSupportsEnvLimit(info.role, org)) {
    limitAccessByEnvironment = false;
  }

  return {
    environments: info.environments || [],
    limitAccessByEnvironment: getLimitAccessByEnvironment(
      info.environments || [],
      limitAccessByEnvironment,
      org,
    ),
    permissions: roleToPermissionMap(info.role, org),
  };
}

export function getUserPermissions(
  user: { id: string; superAdmin?: boolean },
  org: OrganizationInterface,
  teams: TeamInterface[],
): UserPermissions {
  const memberInfo = org.members.find((m) => m.id === user.id);

  // If the user is a super admin, fall back to a default role if they aren't in the org
  if (!memberInfo && user.superAdmin && SUPERADMIN_DEFAULT_ROLE) {
    return {
      global: getUserPermission({ role: SUPERADMIN_DEFAULT_ROLE }, org),
      projects: {},
    };
  }

  if (!memberInfo) {
    throw new Error("User is not a member of this organization");
  }

  const userPermissions: UserPermissions = {
    global: getUserPermission(memberInfo, org),
    projects: {},
  };

  // Build the user-level project permissions
  memberInfo.projectRoles?.forEach((projectRole: ProjectMemberRole) => {
    userPermissions.projects[projectRole.project] = getUserPermission(
      projectRole,
      org,
    );
  });

  // If the user is on a team, merge the team permissions into the user permissions
  if (memberInfo.teams) {
    for (const team of memberInfo.teams) {
      const teamData = teams.find((t) => t.id === team);
      if (teamData) {
        const teamPermissions: UserPermissions = {
          global: getUserPermission(teamData, org),
          projects: {},
        };
        if (teamData.projectRoles) {
          for (const teamProject of teamData.projectRoles) {
            teamPermissions.projects[teamProject.project] = getUserPermission(
              teamProject,
              org,
            );
          }
        }
        mergeUserAndTeamPermissions(userPermissions, teamPermissions, org);
      }
    }
  }

  return userPermissions;
}
