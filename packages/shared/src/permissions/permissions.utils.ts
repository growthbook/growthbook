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
  projectAccess: ReadAccessFilter,
  resourceProjects: string[]
): boolean {
  if (projectAccess.projects.length === 0 || resourceProjects.length === 0) {
    return projectAccess.globalReadAccess;
  }

  if (projectAccess.globalReadAccess) {
    return resourceProjects.every((project) => {
      const projectAccessIndex = projectAccess.projects.findIndex(
        (projectAccess) => projectAccess.id === project
      );
      if (projectAccessIndex === -1) {
        return true;
      }
      return projectAccess.projects[projectAccessIndex].readAccess || false;
    });
  } else {
    return resourceProjects.some((project) => {
      const projectAccessIndex = projectAccess.projects.findIndex(
        (projectAccess) => projectAccess.id === project
      );
      if (projectAccessIndex === -1) {
        return false;
      }
      return projectAccess.projects[projectAccessIndex].readAccess === true;
    });
  }
}
