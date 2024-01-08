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
  resourceProjects: string[] // feature.project or experiment.project or metric.projects
): boolean {
  if (readAccessFilter.projects.length === 0 || resourceProjects.length === 0) {
    return readAccessFilter.globalReadAccess;
  }

  if (readAccessFilter.globalReadAccess) {
    let userHasProjectSpecificAccessForEachResourceProject = true;

    // Check if user has project specific access for each project the resources is in
    for (let i = 0; i < resourceProjects.length; i++) {
      const projectAccessIndex = readAccessFilter.projects.findIndex(
        (projectAccess) => projectAccess.id === resourceProjects[i]
      );
      if (projectAccessIndex === -1) {
        userHasProjectSpecificAccessForEachResourceProject = false;
        break;
      }
    }
    // if user has project specific role for each of the resource's projects, only allow readaccess if they have read access for every project the resource is in.
    // e.g. metric.projects = ["project1", "project2", "project3"] and readAccessFilter.projects = [{id: "project1", readAccess: true}, {id: "project2", readAccess: true}, {id: "project3", readAccess: true}]
    if (userHasProjectSpecificAccessForEachResourceProject) {
      return resourceProjects.every((project) => {
        const projectAccessIndex = readAccessFilter.projects.findIndex(
          (projectAccess) => projectAccess.id === project
        );
        return (
          readAccessFilter.projects[projectAccessIndex].readAccess || false
        );
      });
    } else {
      // otherwise, if user doesn't have project specific role for each resource project, fall back to their global read access.
      // e.g. metric.projects = ["project1", "project2", "project3"] and readAccessFilter.projects = [{id: "project1", readAccess: true}]
      return true;
    }
  } else {
    // User doesn't have global access. If they have project specific access for atleast 1 of the resource projects, they should have access to this.
    // if user has a project specific role for atleast 1 of the resource's projects, and that project-specific role has read access, allow read access.
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
