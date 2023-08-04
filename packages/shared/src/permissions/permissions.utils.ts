import { Permission, UserPermissions } from "back-end/types/organization";

export function hasPermission(
  userPermissions: UserPermissions | undefined,
  permission: Permission,
  project?: string | undefined,
  envs?: string[]
): boolean {
  if (!userPermissions) {
    return false;
  }
  const globalPermissions = userPermissions.global;
  const projectPermissions = userPermissions.projects;

  // We first need to check the global permissions and if the user has the global permission, return;
  if (globalPermissions.permissions[permission]) {
    if (!envs) {
      return true;
    } else {
      if (!globalPermissions.limitAccessByEnvironment) {
        return true;
      } else if (
        globalPermissions.environments.some((e: string) => envs.includes(e))
      ) {
        return true;
      }
    }
  }

  // If the user doesn't have permission from their global role & a project was passed in, check that project
  if (project) {
    const projectToCheck = projectPermissions[project];
    if (projectToCheck && projectToCheck.permissions[permission]) {
      if (!envs) {
        return true;
      } else {
        if (!projectToCheck.limitAccessByEnvironment) {
          return true;
        } else if (
          projectToCheck.environments.some((e: string) => envs.includes(e))
        ) {
          return true;
        }
      }
    }
  }
  return false;
}
