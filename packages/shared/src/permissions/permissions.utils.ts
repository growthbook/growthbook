import {
  Permission,
  UserPermissions,
  MemberRole,
  PermissionsObject,
  OrganizationInterface,
  DefaultMemberRole,
  Role,
} from "back-end/types/organization";

export const POLICIES = [
  "ReadData",
  "Comments",
  "FeaturesFullAccess",
  "ArchetypesFullAccess",
  "FeaturesBypassApprovals",
  "ExperimentsFullAccess",
  "VisualEditorFullAccess",
  "SuperDeleteReports",
  "DataSourcesFullAccess",
  "DataSourceConfiguration",
  "RunQueries",
  "MetricsFullAccess",
  "FactTablesFullAccess",
  "FactMetricsFiltersFullAccess",
  "DimensionsFullAccess",
  "SegmentsFullAccess",
  "IdeasFullAccess",
  "PresentationsFullAccess",
  "SDKPayloadPublish",
  "SDKConnectionsFullAccess",
  "AttributesFullAccess",
  "EnvironmentsFullAccess",
  "NamespacesFullAccess",
  "SavedGroupsFullAccess",
  "GeneralSettingsFullAccess",
  "NorthStarMetricFullAccess",
  "TeamManagementFullAccess",
  "ProjectsFullAccess",
  "TagsFullAccess",
  "APIKeysFullAccess",
  "IntegrationsFullAccess",
  "EventWebhooksFullAccess",
  "BillingFullAccess",
  "AuditLogsFullAccess",
] as const;

export type Policy = typeof POLICIES[number];

export const POLICY_PERMISSION_MAP: Record<Policy, Permission[]> = {
  ReadData: ["readData"],
  Comments: ["readData", "addComments"],
  FeaturesFullAccess: [
    "readData",
    "manageFeatureDrafts",
    "manageFeatures",
    "canReview",
  ],
  ArchetypesFullAccess: ["readData", "manageArchetype"],
  FeaturesBypassApprovals: [
    "readData",
    "manageFeatureDrafts",
    "manageFeatures",
    "canReview",
    "bypassApprovalChecks",
  ],
  ExperimentsFullAccess: ["readData", "createAnalyses"],
  VisualEditorFullAccess: ["readData", "manageVisualChanges"],
  SuperDeleteReports: ["readData", "superDeleteReport"],
  DataSourcesFullAccess: [
    "readData",
    "createDatasources",
    "editDatasourceSettings",
  ],
  DataSourceConfiguration: ["readData", "editDatasourceSettings"],
  RunQueries: ["readData", "runQueries"],
  MetricsFullAccess: ["readData", "createMetrics"],
  // TODO: Fix fact permissions
  FactTablesFullAccess: ["readData", "manageFactTables", "createMetrics"],
  FactMetricsFiltersFullAccess: ["readData", "createMetrics"],
  DimensionsFullAccess: ["readData", "createDimensions"],
  SegmentsFullAccess: ["readData", "createSegments"],
  IdeasFullAccess: ["readData", "createIdeas"],
  PresentationsFullAccess: ["readData", "createPresentations"],
  SDKPayloadPublish: ["readData", "publishFeatures", "runExperiments"],
  // TODO: add permissions
  SDKConnectionsFullAccess: ["readData"],
  AttributesFullAccess: ["readData", "manageTargetingAttributes"],
  EnvironmentsFullAccess: ["readData", "manageEnvironments"],
  NamespacesFullAccess: ["readData", "manageNamespaces"],
  SavedGroupsFullAccess: ["readData", "manageSavedGroups"],
  GeneralSettingsFullAccess: ["readData", "organizationSettings"],
  NorthStarMetricFullAccess: ["readData", "manageNorthStarMetric"],
  TeamManagementFullAccess: ["readData", "manageTeam"],
  ProjectsFullAccess: ["readData", "manageProjects"],
  TagsFullAccess: ["readData", "manageTags"],
  APIKeysFullAccess: ["readData", "manageApiKeys"],
  IntegrationsFullAccess: ["readData", "manageIntegrations"],
  EventWebhooksFullAccess: ["readData", "manageWebhooks"],
  BillingFullAccess: ["readData", "manageBilling"],
  AuditLogsFullAccess: ["readData", "viewEvents"],
};

export const DEFAULT_ROLES: Record<DefaultMemberRole, Role> = {
  noaccess: {
    id: "noaccess",
    description:
      "Cannot view any features or experiments. Most useful when combined with project-scoped roles.",
    policies: [],
  },
  readonly: {
    id: "readonly",
    description: "View all features and experiment results",
    policies: ["ReadData"],
  },
  collaborator: {
    id: "collaborator",
    description: "Add comments and contribute ideas",
    policies: [
      "ReadData",
      "Comments",
      "IdeasFullAccess",
      "PresentationsFullAccess",
    ],
  },
  visualEditor: {
    id: "visualEditor",
    description: "Make visual changes for an experiment",
    policies: ["ReadData", "VisualEditorFullAccess"],
  },
  engineer: {
    id: "engineer",
    description: "Manage features",
    policies: [
      "ReadData",
      "Comments",
      "FeaturesFullAccess",
      "ArchetypesFullAccess",
      "VisualEditorFullAccess",
      "IdeasFullAccess",
      "PresentationsFullAccess",
      "SDKPayloadPublish",
      "SDKConnectionsFullAccess",
      "AttributesFullAccess",
      "EnvironmentsFullAccess",
      "NamespacesFullAccess",
      "SavedGroupsFullAccess",
      "TagsFullAccess",
    ],
  },
  analyst: {
    id: "analyst",
    description: "Analyze experiments",
    policies: [
      "ReadData",
      "Comments",
      "RunQueries",
      "MetricsFullAccess",
      "ExperimentsFullAccess",
      "VisualEditorFullAccess",
      "FactTablesFullAccess",
      "FactMetricsFiltersFullAccess",
      "DimensionsFullAccess",
      "SegmentsFullAccess",
      "IdeasFullAccess",
      "PresentationsFullAccess",
      "TagsFullAccess",
      "DataSourceConfiguration",
    ],
  },
  experimenter: {
    id: "experimenter",
    description: "Manage features AND Analyze experiments",
    policies: [
      "ReadData",
      "Comments",
      "FeaturesFullAccess",
      "ExperimentsFullAccess",
      "VisualEditorFullAccess",
      "ArchetypesFullAccess",
      "RunQueries",
      "MetricsFullAccess",
      "FactTablesFullAccess",
      "FactMetricsFiltersFullAccess",
      "DimensionsFullAccess",
      "SegmentsFullAccess",
      "IdeasFullAccess",
      "PresentationsFullAccess",
      "SDKPayloadPublish",
      "SDKConnectionsFullAccess",
      "AttributesFullAccess",
      "EnvironmentsFullAccess",
      "NamespacesFullAccess",
      "SavedGroupsFullAccess",
      "TagsFullAccess",
      "DataSourceConfiguration",
    ],
  },
  admin: {
    id: "admin",
    description:
      "All access + invite teammates and configure organization settings",
    policies: [...POLICIES],
  },
};

export function policiesSupportEnvLimit(policies: Policy[]): boolean {
  // If any policies have a permission that is env scoped, return true
  return policies.some((policy) =>
    POLICY_PERMISSION_MAP[policy]?.some((permission) =>
      ENV_SCOPED_PERMISSIONS.includes(
        permission as typeof ENV_SCOPED_PERMISSIONS[number]
      )
    )
  );
}

export function getPermissionsObjectByPolicies(
  policies: Policy[]
): PermissionsObject {
  const permissions: PermissionsObject = {};

  policies.forEach((policy) => {
    POLICY_PERMISSION_MAP[policy]?.forEach((permission) => {
      permissions[permission] = true;
    });
  });

  return permissions;
}

export function getRoleById(
  roleId: string,
  organization: OrganizationInterface
): Role | null {
  const roles = getRoles(organization);

  return roles.find((role) => role.id === roleId) || null;
}

export function getRoles(org: OrganizationInterface) {
  // Always start with noaccess and readonly
  const roles = [DEFAULT_ROLES.noaccess, DEFAULT_ROLES.readonly];

  // Role ids must be unique (admin is added at the end, which is why it's here)
  const usedIds = new Set(["noaccess", "readonly", "admin"]);

  // Add additional roles
  const customRoles =
    org.useCustomRoles && org.customRoles
      ? org.customRoles
      : Object.values(DEFAULT_ROLES);
  customRoles.forEach((role) => {
    if (usedIds.has(role.id)) return;
    usedIds.add(role.id);
    roles.push(role);
  });

  // Always add admin at the end
  roles.push(DEFAULT_ROLES.admin);

  return roles;
}

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
  "manageFeatureDrafts",
  "manageFeatures",
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
  "superDeleteReport",
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

export function roleSupportsEnvLimit(
  roleId: MemberRole,
  org: OrganizationInterface
): boolean {
  if (roleId === "admin") return false;

  const role = getRoleById(roleId, org);

  return policiesSupportEnvLimit(role?.policies || []);
}
