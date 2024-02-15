import {
  Permission,
  UserPermissions,
  MemberRole,
} from "back-end/types/organization";

const permissionsThatRequireOnlyOneProject: Partial<Permission>[] = [
  "runQueries",
  "readData",
];

export function doesUserHavePermission(
  userPermissions: UserPermissions | undefined,
  permissionToCheck: Permission,
  projects: (string | undefined)[],
  envs?: string[]
): boolean {
  // Some permissions require that the user have the permission in atleast 1 project
  if (permissionsThatRequireOnlyOneProject.includes(permissionToCheck)) {
    let hasPermission = false;

    for (const project of projects) {
      // This project is in ALL PROJECTS so check the user's global permissions and every project they have specific permissions for
      if (project === undefined) {
        // Check their global permissions first
        if (userPermissions?.global.permissions[permissionToCheck]) {
          hasPermission = true;
          break;
        }
        // if their global permissions don't give them permission, check every project they have specific permissions for & see if any of those grant permission
        for (const project in userPermissions?.projects) {
          if (
            userPermissions?.projects[project]?.permissions[permissionToCheck]
          ) {
            hasPermission = true;
            break;
          }
        }
        break;
      }

      // Otherwise, the resource has a project, so check the user's global role and the project's specific role
      // if either of those grant access, then the user has access
      if (
        userPermissions?.projects[project]?.permissions[permissionToCheck] ||
        userPermissions?.global.permissions[permissionToCheck]
      ) {
        hasPermission = true;
        break;
      }
    }
    return hasPermission;
  }
  // Other permissions require that the user have the permission in EVERY project
  let hasPermission = true;
  for (const project of projects) {
    const usersPermissionsToCheck =
      (project && userPermissions?.projects[project]) ||
      userPermissions?.global;

    if (
      !usersPermissionsToCheck ||
      !usersPermissionsToCheck.permissions[permissionToCheck]
    ) {
      hasPermission = false;
      break;
    }

    if (envs && usersPermissionsToCheck.limitAccessByEnvironment) {
      const userHasEnvPermissions = envs.every((env) =>
        usersPermissionsToCheck.environments.includes(env)
      );
      if (!userHasEnvPermissions) {
        hasPermission = false;
        break;
      }
    }
  }
  return hasPermission;
}

export function roleSupportsEnvLimit(role: MemberRole): boolean {
  return ["engineer", "experimenter"].includes(role);
}

export type ReadAccessFilter = {
  globalReadAccess: boolean;
  projects: { id: string; readAccess: boolean }[];
};

// there are some cases, like in async jobs, where we need to provide the job with full access permission. E.G. updateScheduledFeature
export const FULL_ACCESS_PERMISSIONS: ReadAccessFilter = {
  globalReadAccess: true,
  projects: [],
};

export function getApiKeyReadAccessFilter(
  role: string | undefined
): ReadAccessFilter {
  let readAccessFilter: ReadAccessFilter = {
    globalReadAccess: false,
    projects: [],
  };

  // Eventually, we may support API keys that don't have readAccess for all projects
  if (role && (role === "admin" || role === "readonly")) {
    readAccessFilter = FULL_ACCESS_PERMISSIONS;
  }

  return readAccessFilter;
}

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
  projects: string | string[] | undefined
): boolean {
  // If the resource is available to all projects (an empty array), then everyone should have read access
  if (Array.isArray(projects) && !projects?.length) {
    return true;
  }

  const hasGlobaReadAccess = filter.globalReadAccess;

  // if the user doesn't have project specific roles or resource doesn't have a project (project is an empty string), fallback to user's global role
  if (!filter.projects.length || !projects) {
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
