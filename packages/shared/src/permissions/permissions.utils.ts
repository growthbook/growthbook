import {
  Permission,
  UserPermissions,
  MemberRole,
} from "back-end/types/organization";

export function hasPermission(
  userPermissions: UserPermissions | undefined,
  permissionToCheck: Permission,
  project?: string | undefined,
  envs?: string[]
): boolean {
  const usersPermissionsToCheck =
    (project && userPermissions?.projects[project]) || userPermissions?.global;

  if (
    !usersPermissionsToCheck ||
    !usersPermissionsToCheck.permissions[permissionToCheck]
  ) {
    return false;
  }

  if (!envs || !usersPermissionsToCheck.limitAccessByEnvironment) {
    return true;
  }
  return envs.every((env) =>
    usersPermissionsToCheck.environments.includes(env)
  );
}

export function hasReadAccess(
  currentUserPermissions: UserPermissions,
  resourceProjects: string[]
): boolean {
  const usersGlobalRoleHasReadPermissions =
    currentUserPermissions.global.permissions.readData || false;
  const userHasProjectSpecificPermissions = !!Object.keys(
    currentUserPermissions.projects
  ).length;

  if (!userHasProjectSpecificPermissions || !resourceProjects.length) {
    return usersGlobalRoleHasReadPermissions;
  }

  // if the user's global permissions allow them to read data AND the user has read access to atleast 1 project the resource is connected to, return true
  if (usersGlobalRoleHasReadPermissions) {
    return resourceProjects.every(
      (project) =>
        currentUserPermissions.projects[project]?.permissions.readData === true
    );
  } else {
    return resourceProjects.some(
      (project) =>
        currentUserPermissions.projects[project]?.permissions.readData === true
    );
  }
}

export function roleSupportsEnvLimit(role: MemberRole): boolean {
  return ["engineer", "experimenter"].includes(role);
}
