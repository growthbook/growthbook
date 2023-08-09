import {
  Permission,
  UserPermission,
  UserPermissions,
} from "back-end/types/organization";

export function hasPermission(
  userPermissions: UserPermissions | undefined,
  permissionToCheck: Permission,
  project?: string | undefined,
  envs?: string[]
): boolean {
  if (!userPermissions) {
    return false;
  }

  function checkPermissions(userPermission: UserPermission) {
    if (!userPermission.permissions[permissionToCheck]) {
      return false;
    }

    if (!envs || !userPermission.limitAccessByEnvironment) {
      return true;
    }
    return envs.every((env) => userPermission.environments.includes(env));
  }

  if (checkPermissions(userPermissions.global)) {
    return true;
  }

  // If the user doesn't have global permissions, and a project was passed in, check the user's permissions for that project
  if (project) {
    const projectPermissions = userPermissions.projects[project];
    if (projectPermissions && checkPermissions(projectPermissions)) {
      return true;
    }
  }

  return false;
}
