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
  "createFeatureDrafts",
  "manageFeatures",
  "manageProjects",
  "createAnalyses",
  "createIdeas",
  "createMetrics",
  "manageFactTables",
  "createDatasources",
  "editDatasourceSettings",
  "runQueries",
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
  "manageTargetingAttributes",
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

export const READ_ONLY_PERMISSIONS = ["readData", "viewEvents", "runQueries"];

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

export const GB_MANAGED_POLICY_IDS = [
  "GB_View_Data",
  "GB_Create_Ideas",
  "GB_Create_Presentations",
  "GB_Write_Comments",
  "GB_Manage_Visual_Changes",
  "GB_Publish_Features",
  "GB_Manage_Features",
  "GB_Manage_Tags",
  "GB_Create_Feature_Drafts",
  "GB_Manage_Targeting_Attributes",
  "GB_Manage_Environments",
  "GB_Manage_Namespaces",
  "GB_Manage_Saved_Groups",
  "GB_Manage_Archetype",
  "GB_Run_Experiments",
  "GB_Manage_Fact_Tables",
  "GB_Create_Metrics",
  "GB_Create_Dimensions",
  "GB_Create_Segments",
  "GB_Create_Analyses",
  "GB_Run_Queries",
  "GB_Manage_Team",
  "GB_Manage_Api_Keys",
  "GB_Manage_Integrations",
  "GB_Edit_Datasource_Settings",
  "GB_Manage_Billing",
  "GB_Manage_North_Star_Metric",
  "GB_Manage_Projects",
  "GB_Manage_Webhooks",
  "GB_View_Events",
  "GB_Super_Delete",
  "GB_Manage_Organization_Settings",
  "GB_Create_Datasources",
] as const;

export type GB_Managed_Policy = typeof GB_MANAGED_POLICY_IDS[number];

const GB_Managed_Policies: {
  id: GB_Managed_Policy;
  description: string;
  permissions: Permission[];
}[] = [
  {
    id: "GB_View_Data",
    description: "Allows the user to view data",
    permissions: ["readData"],
  },
  {
    id: "GB_Create_Ideas",
    description: "Allows the user to create ideas",
    permissions: ["createIdeas"],
  },
  {
    id: "GB_Create_Presentations",
    description: "Allows the user to create presentations",
    permissions: ["createPresentations"],
  },
  {
    id: "GB_Write_Comments",
    description:
      "Allows the user to add comments to all resources that support comments. Features, experiments, metrics, and ideas.",
    permissions: ["addComments"],
  },
  {
    id: "GB_Manage_Visual_Changes",
    description:
      "Allows the user to make changes for an experiment via the Visual Editor",
    permissions: ["manageVisualChanges"],
  },
  {
    id: "GB_Publish_Features",
    description: "Allows the user to publish features",
    permissions: ["publishFeatures"],
  },
  {
    id: "GB_Manage_Features",
    description: "Allows the user to manage features", //TODO: Expand on this description
    permissions: ["manageFeatures"],
  },
  {
    id: "GB_Manage_Tags",
    description: "Allows the user to create, edit, and delete tags",
    permissions: ["manageTags"],
  },
  {
    id: "GB_Create_Feature_Drafts",
    description: "Allows the user to create feature drafts",
    permissions: ["createFeatureDrafts"],
  },
  {
    id: "GB_Manage_Targeting_Attributes",
    description:
      "Allows the user to create, edit, and delete targeting attributes",
    permissions: ["manageTargetingAttributes"],
  },
  {
    id: "GB_Manage_Environments",
    description: "Allows the user to create, edit, and delete environments",
    permissions: ["manageEnvironments"],
  },
  {
    id: "GB_Manage_Namespaces",
    description: "Allows the user to  reate, edit, and delete namespaces",
    permissions: ["manageNamespaces"],
  },
  {
    id: "GB_Manage_Saved_Groups",
    description: "Allows the user to  reate, edit, and delete saved groups",
    permissions: ["manageSavedGroups"],
  },
  {
    id: "GB_Manage_Archetype",
    description: "Allows the user to  reate, edit, and delete archetype",
    permissions: ["manageArchetype"],
  },
  {
    id: "GB_Run_Experiments",
    description: "Allows the user to run experiments",
    permissions: ["runExperiments"],
  },
  {
    id: "GB_Manage_Fact_Tables",
    description: "Allows the user to  reate, edit, and delete fact tables",
    permissions: ["manageFactTables"],
  },
  {
    id: "GB_Create_Metrics",
    description: "Allows the user to create metrics",
    permissions: ["createMetrics"],
  },
  {
    id: "GB_Create_Dimensions",
    description: "Allows the user to create dimensions",
    permissions: ["createDimensions"],
  },
  {
    id: "GB_Create_Segments",
    description: "Allows the user to create segments",
    permissions: ["createSegments"],
  },
  {
    id: "GB_Create_Analyses",
    description: "Allows the user to create analyses",
    permissions: ["createAnalyses"],
  },
  {
    id: "GB_Edit_Datasource_Settings",
    description: "Allows the user to create and edit data sources",
    permissions: ["editDatasourceSettings"],
  },
  {
    id: "GB_Create_Datasources",
    description: "Allows the user to  reate, edit, and delete data sources",
    permissions: ["createDatasources"],
  },
  {
    id: "GB_Run_Queries",
    description: "Allows the user to run queries",
    permissions: ["runQueries"],
  },
  {
    id: "GB_Manage_Team",
    description:
      "Allows the user to add, update, and remove team members. Also allows user to manage Teams if your plan supports it.",
    permissions: ["manageTeam"],
  },
  {
    id: "GB_Manage_Api_Keys",
    description: "Allows the user to create, edit, and delete api keys",
    permissions: ["manageApiKeys"],
  },
  {
    id: "GB_Manage_Integrations",
    description: "Allows the user to create, edit, and delete integrations",
    permissions: ["manageIntegrations"],
  },
  {
    id: "GB_Manage_Billing",
    description: "Allows the user to manage billing",
    permissions: ["manageBilling"],
  },
  {
    id: "GB_Manage_North_Star_Metric",
    description:
      "Allows the user to create, edit, and delete north star metric",
    permissions: ["manageNorthStarMetric"],
  },
  {
    id: "GB_Manage_Projects",
    description: "Allows the user to create, edit, and delete projects",
    permissions: ["manageProjects"],
  },
  {
    id: "GB_Manage_Webhooks",
    description: "Allows the user to create, edit, and delete webhooks",
    permissions: ["manageWebhooks"],
  },
  {
    id: "GB_View_Events",
    description: "Allows the user to view events", //TODO: Improve this description
    permissions: ["viewEvents"],
  },
  {
    id: "GB_Super_Delete",
    description: "Allows the user to super delete", //TODO: Improve this description
    permissions: ["superDelete"],
  },
  {
    id: "GB_Manage_Organization_Settings",
    description: "Allows the user to manage organization settings", //TODO: Improve this description
    permissions: ["organizationSettings"],
  },
];

export function getPermissionsFromPolicies(
  policyArr: GB_Managed_Policy[] | undefined
): Permission[] {
  if (!policyArr) return [];
  //TODO: Add some in-mem cache here?
  const permissions: Permission[] = [];

  policyArr.forEach((policy) => {
    const foundPolicy = GB_Managed_Policies.find((p) => p.id === policy);
    if (foundPolicy) {
      permissions.push(...foundPolicy.permissions);
    }
  });

  return permissions;
}
