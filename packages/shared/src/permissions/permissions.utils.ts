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

export type ProjectAccessObject = {
  globalReadAccess: boolean;
  projects: { id: string; readAccess: boolean }[];
};

export function getProjectAccess(userPermissions: UserPermissions) {
  const projectAccess: ProjectAccessObject = {
    globalReadAccess: userPermissions.global.permissions.readData || false,
    projects: [],
  };

  Object.keys(userPermissions.projects).forEach((project) => {
    projectAccess.projects.push({
      id: project,
      readAccess:
        userPermissions.projects[project].permissions.readData || false,
    });
  });

  return projectAccess;
}

export function hasProjectAccess(
  projectAccess: ProjectAccessObject,
  resourceProjects: string[]
): boolean {
  if (projectAccess.projects.length === 0 || resourceProjects.length === 0) {
    return projectAccess.globalReadAccess;
  }

  if (projectAccess.globalReadAccess) {
    let hasAccess = false;
    //TODO: Figure out this logic below
    // The user has global read access - now. Return true unless every project in the resourceProjects array
    resourceProjects.forEach((project) => {
      const projectAccessIndex = projectAccess.projects.findIndex(
        (projectAccess) => projectAccess.id === project
      );

      if (
        projectAccessIndex !== -1 &&
        projectAccess.projects[projectAccessIndex].readAccess === true
      ) {
        hasAccess = true;
      }
    });
    return hasAccess;
  } else {
    let hasAccess = false;

    resourceProjects.forEach((project) => {
      const projectAccessIndex = projectAccess.projects.findIndex(
        (projectAccess) => projectAccess.id === project
      );

      if (
        projectAccessIndex !== -1 &&
        projectAccess.projects[projectAccessIndex].readAccess === true
      ) {
        hasAccess = true;
      }
    });
    return hasAccess;
  }

  // The user's global role DOES NOT have read access
  // Return true IF the user has read access to atleast 1 project in the resourceProjects array

  // The user does not have global read access, check if the user has access to any of the resource's projects
  // If the user has access to atleast 1 project, return true
  // If the user does not have access to any of the resource's projects, return false
}
