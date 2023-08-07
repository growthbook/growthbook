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

  // Small utility method to check if the user has permission
  function checkPermissions(userPermissions: UserPermission) {
    if (userPermissions.permissions[permissionToCheck]) {
      if (!envs || !userPermissions.limitAccessByEnvironment) {
        return true;
      } else {
        return userPermissions.environments.some((e: string) =>
          envs.includes(e)
        );
      }
    }
    return false;
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
