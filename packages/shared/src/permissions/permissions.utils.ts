import {
  Permission,
  UserPermissions,
  MemberRole,
} from "back-end/types/organization";

export const ENV_SCOPED_PERMISSIONS = [
  "publishFeatures",
  "manageEnvironments",
  "runExperiments",
] as const;

export const PROJECT_SCOPED_PERMISSIONS = [
  "readData",
  "addComments",
  "bypassApprovalChecks",
  "canReview",
  "createFeatureDrafts",
  "manageFeatures", //canCreateFeature, //canUpdateFeature, //canDeleteFeature
  "manageProjects",
  "createAnalyses",
  "createIdeas",
  "createMetrics",
  "manageFactTables",
  "createDatasources",
  "editDatasourceSettings",
  "runQueries",
  "manageTargetingAttributes",
  "manageVisualChanges",
] as const;

export const GLOBAL_PERMISSIONS = [
  "readData",
  "createPresentations",
  "createDimensions",
  "createSegments",
  "organizationSettings",
  "superDelete",
  "manageTeam",
  "manageTags",
  "manageApiKeys",
  "manageIntegrations",
  "manageWebhooks",
  "manageBilling",
  "manageNorthStarMetric",
  "manageNamespaces",
  "manageSavedGroups",
  "manageArchetype",
  "viewEvents",
] as const;

export const ALL_PERMISSIONS = [
  ...GLOBAL_PERMISSIONS,
  ...PROJECT_SCOPED_PERMISSIONS,
  ...ENV_SCOPED_PERMISSIONS,
];

export const READ_ONLY_PERMISSIONS = [
  "readData",
  "viewEvents",
  "runQueries",
  "addComments",
];

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

export const userHasPermission = (
  superAdmin: boolean,
  userPermissions: UserPermissions,
  permission: Permission,
  project?: string | (string | undefined)[] | undefined,
  envs?: string[]
): boolean => {
  if (superAdmin) {
    return true;
  }

  let checkProjects: (string | undefined)[];
  if (Array.isArray(project)) {
    checkProjects = project.length > 0 ? project : [undefined];
  } else {
    checkProjects = [project];
  }

  if (READ_ONLY_PERMISSIONS.includes(permission)) {
    if (
      checkProjects.length === 1 &&
      checkProjects[0] === undefined &&
      Object.keys(userPermissions.projects).length
    ) {
      // add all of the projects the user has project-level roles for
      checkProjects.push(...Object.keys(userPermissions.projects));
    }
    // Read only type permissions grant permission if the user has the permission globally or in atleast 1 project
    return checkProjects.some((p) =>
      hasPermission(userPermissions, permission, p, envs)
    );
  } else {
    // All other permissions require the user to have the permission globally or the user must have the permission in every project they have specific permissions for
    return checkProjects.every((p) =>
      hasPermission(userPermissions, permission, p, envs)
    );
  }
};

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
