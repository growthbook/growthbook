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

  Object.entries(userPermissions.projects).forEach(
    ([project, projectPermissions]) => {
      readAccess.projects.push({
        id: project,
        readAccess: projectPermissions.permissions.readData || false,
      });
    }
  );

  return readAccess;
}
export function hasReadAccess(
  filter: ReadAccessFilter,
  projects: string | string[] | null | undefined
): boolean {
  const hasGlobaReadAccess = filter.globalReadAccess;

  // if the user doesn't have project specific roles, or the resource doesn't have any projects, fallback to user's global role
  if (!filter.projects.length || !projects || !projects.length) {
    return hasGlobaReadAccess;
  }

  const resourceProjects = Array.isArray(projects) ? projects : [projects];

  // if the user doesn't have global read access, but they do have read access for atleast one of the resource's projects, allow read access to resource
  if (!hasGlobaReadAccess) {
    return resourceProjects.some((project) => {
      return filter.projects.some((p) => p.id === project && p.readAccess);
    });
  }

  // otherwise, don't allow read access only if the user's project-specific roles restrict read access for all of the resource's projects
  const everyProjectRestrictsReadAccess = resourceProjects.every((project) => {
    return filter.projects.some((p) => p.id === project && !p.readAccess);
  });

  return everyProjectRestrictsReadAccess ? false : true;
}
