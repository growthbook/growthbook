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

export const POLICY_PERMISSION_MAP: Record<
  Policy,
  {
    description: string;
    group: string;
    warning?: string;
    permissions: Permission[];
  }
> = {
  ReadData: {
    group: "Global",
    description:
      "View all resources - features, metrics, experiments, data sources, etc.",
    permissions: ["readData"],
  },
  Comments: {
    group: "Global",
    description: "Add comments to any resource",
    permissions: ["readData", "addComments"],
  },
  FeaturesFullAccess: {
    group: "Features",
    description: "Create, edit, and delete feature flags",
    permissions: [
      "readData",
      "manageFeatureDrafts",
      "manageFeatures",
      "manageArchetype",
      "canReview",
    ],
  },
  ArchetypesFullAccess: {
    group: "Features",
    description:
      "Create, edit, and delete saved User Archetypes for feature flag debugging",
    permissions: ["readData", "manageArchetype"],
  },
  FeaturesBypassApprovals: {
    group: "Features",
    description: "Bypass required approval checks for feature flag changes",
    permissions: [
      "readData",
      "manageFeatureDrafts",
      "manageFeatures",
      "canReview",
      "bypassApprovalChecks",
    ],
  },
  ExperimentsFullAccess: {
    group: "Experiments",
    description:
      "Create, edit, and delete experiments. Does not include Visual Editor access.",
    permissions: ["readData", "createAnalyses"],
  },
  VisualEditorFullAccess: {
    group: "Experiments",
    description: "Use the Visual Editor to implement experiment changes.",
    permissions: ["readData", "manageVisualChanges"],
  },
  SuperDeleteReports: {
    group: "Experiments",
    description:
      "Delete ad-hoc reports made by other users. Typically assigned to admins only.",
    permissions: ["readData", "superDeleteReport"],
  },
  DataSourcesFullAccess: {
    group: "Metrics and Data",
    description: "Create, edit, and delete data sources",
    permissions: ["readData", "createDatasources", "editDatasourceSettings"],
  },
  DataSourceConfiguration: {
    group: "Metrics and Data",
    description:
      "Edit existing data source configuration settings (identifier types, experiment assignment queries)",
    permissions: ["readData", "editDatasourceSettings"],
  },
  RunQueries: {
    group: "Metrics and Data",
    description:
      "Execute queries against data sources. Required to refresh experiment results.",
    permissions: ["readData", "runQueries"],
  },
  MetricsFullAccess: {
    group: "Metrics and Data",
    description:
      "Create, edit, and delete regular metrics (does not include Fact Metrics)",
    permissions: ["readData", "createMetrics"],
  },
  // TODO: add new permissions for fact metrics and filters
  FactTablesFullAccess: {
    group: "Metrics and Data",
    description: "Create, edit, and delete fact tables, metrics, and filters.",
    permissions: ["readData", "manageFactTables", "createMetrics"],
  },
  // TODO: add new permissions for fact metrics and filters
  FactMetricsFiltersFullAccess: {
    group: "Metrics and Data",
    description:
      "Create, edit, and delete fact metrics and filters only (cannot edit the fact table itself)",
    permissions: ["readData", "createMetrics"],
  },
  DimensionsFullAccess: {
    group: "Metrics and Data",
    description: "Create, edit, and delete dimensions",
    permissions: ["readData", "createDimensions"],
  },
  SegmentsFullAccess: {
    group: "Metrics and Data",
    description: "Create, edit, and delete segments",
    permissions: ["readData", "createSegments"],
  },
  IdeasFullAccess: {
    group: "Management",
    description: "Create, edit, and delete ideas",
    permissions: ["readData", "createIdeas"],
  },
  PresentationsFullAccess: {
    group: "Management",
    description: "Create, edit, and delete presentations",
    permissions: ["readData", "createPresentations"],
  },
  SDKPayloadPublish: {
    group: "SDK Configuration",
    description:
      "Make changes that affect data sent to SDKs. For example: edit a saved group, toggle a feature flag, stop an experiment, etc.",
    permissions: ["readData", "publishFeatures", "runExperiments"],
  },
  // TODO: add permissions for SDK connections and webhooks
  SDKConnectionsFullAccess: {
    group: "SDK Configuration",
    description: "Create, edit, and delete SDK Connections",
    permissions: ["readData"],
  },
  AttributesFullAccess: {
    group: "SDK Configuration",
    description: "Create, edit, and delete targeting attributes",
    permissions: ["readData", "manageTargetingAttributes"],
  },
  EnvironmentsFullAccess: {
    group: "SDK Configuration",
    description: "Create, edit, and delete environments",
    permissions: ["readData", "manageEnvironments"],
  },
  NamespacesFullAccess: {
    group: "SDK Configuration",
    description: "Create, edit, and delete namespaces",
    permissions: ["readData", "manageNamespaces"],
  },
  SavedGroupsFullAccess: {
    group: "SDK Configuration",
    description: "Create, edit, and delete saved groups",
    permissions: ["readData", "manageSavedGroups"],
  },
  GeneralSettingsFullAccess: {
    group: "Settings",
    description: "Edit organization general settings",
    permissions: ["readData", "organizationSettings"],
  },
  NorthStarMetricFullAccess: {
    group: "Settings",
    description: "Configure North Star metrics",
    permissions: ["readData", "manageNorthStarMetric"],
  },
  TeamManagementFullAccess: {
    group: "Settings",
    description:
      "Invite users, delete users, change user roles, add/remove users from teams.",
    warning: "Can be used to create new admin users",
    permissions: ["readData", "manageTeam"],
  },
  ProjectsFullAccess: {
    group: "Settings",
    description: "Create, edit, and delete projects",
    permissions: ["readData", "manageProjects"],
  },
  TagsFullAccess: {
    group: "Settings",
    description: "Create, edit, and delete tags",
    permissions: ["readData", "manageTags"],
  },
  APIKeysFullAccess: {
    group: "Settings",
    description:
      "Create, edit, and delete API secret keys. Not required to create Personal Access Tokens.",
    warning: "Can be used to create an API Key with full admin permissions.",
    permissions: ["readData", "manageApiKeys"],
  },
  IntegrationsFullAccess: {
    group: "Settings",
    description: "Set up and configure integrations - GitHub, Vercel, etc.",
    permissions: ["readData", "manageIntegrations"],
  },
  // TODO: use new permission name for event webhooks
  EventWebhooksFullAccess: {
    group: "Settings",
    description:
      "Create, edit, and delete event-based webhooks. Used for Slack/Discord notifications.",
    permissions: ["readData", "manageWebhooks"],
  },
  BillingFullAccess: {
    group: "Settings",
    description:
      "View and edit license key. View invoices and update billing info.",
    permissions: ["readData", "manageBilling"],
  },
  AuditLogsFullAccess: {
    group: "Settings",
    description: "View and export audit logs",
    permissions: ["readData", "viewEvents"],
  },
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
    POLICY_PERMISSION_MAP[policy]?.permissions?.some((permission) =>
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
    POLICY_PERMISSION_MAP[policy]?.permissions?.forEach((permission) => {
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
