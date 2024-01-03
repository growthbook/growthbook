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

export function roleSupportsEnvLimit(role: MemberRole): boolean {
  return ["engineer", "experimenter"].includes(role);
}

export type ReadAccessFilter = {
  globalReadAccess: boolean;
  projects: { id: string; readAccess: boolean }[];
};

export function getReadAccessFilter(userPermissions: UserPermissions) {
  const readAccess: ReadAccessFilter = {
    globalReadAccess: userPermissions.global.permissions.readData || false,
    projects: [],
  };

  Object.keys(userPermissions.projects).forEach((project) => {
    readAccess.projects.push({
      id: project,
      readAccess:
        userPermissions.projects[project].permissions.readData || false,
    });
  });

  return readAccess;
}

export function hasReadAccess(
  readAccessFilter: ReadAccessFilter,
  resourceProjects: string[]
): boolean {
  if (readAccessFilter.projects.length === 0 || resourceProjects.length === 0) {
    return readAccessFilter.globalReadAccess;
  }

  if (readAccessFilter.globalReadAccess) {
    let userHasProjectSpecificAccessForEachResourceProject = true;

    // Check if user has project specific access for each resource project
    for (let i = 0; i < resourceProjects.length; i++) {
      const projectAccessIndex = readAccessFilter.projects.findIndex(
        (projectAccess) => projectAccess.id === resourceProjects[i]
      );
      if (projectAccessIndex === -1) {
        userHasProjectSpecificAccessForEachResourceProject = false;
        break;
      }
    }

    // If user doesn't have project specific access for each resource project, they should have access to this, given their global role gives them access
    if (!userHasProjectSpecificAccessForEachResourceProject) {
      return true;
    } else {
      // otherwise, if they do have project specific access for each resource project, only allow readaccess if they have read access for every project the resource is in.
      return resourceProjects.every((project) => {
        const projectAccessIndex = readAccessFilter.projects.findIndex(
          (projectAccess) => projectAccess.id === project
        );
        return (
          readAccessFilter.projects[projectAccessIndex].readAccess || false
        );
      });
    }
  } else {
    return resourceProjects.some((project) => {
      const projectAccessIndex = readAccessFilter.projects.findIndex(
        (projectAccess) => projectAccess.id === project
      );
      if (projectAccessIndex === -1) {
        return false;
      }
      return readAccessFilter.projects[projectAccessIndex].readAccess === true;
    });
  }
}
