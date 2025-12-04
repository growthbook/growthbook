import {
  DefaultMemberRole,
  Permission,
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
  "FactMetricsFullAccess",
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
  "SavedGroupsBypassSizeLimit",
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
  "CustomRolesFullAccess",
  "CustomFieldsFullAccess",
  "TemplatesFullAccess",
  "DecisionCriteriaFullAccess",
  "SqlExplorerFullAccess",
  "HoldoutsFullAccess",
  "CustomHooksFullAccess",
  "ManageOfficialResources",
  "GeneralDashboardsFullAccess",
] as const;

export type Policy = (typeof POLICIES)[number];

export const POLICY_PERMISSION_MAP: Record<Policy, Permission[]> = {
  ReadData: ["readData"],
  Comments: ["readData", "addComments"],
  FeaturesFullAccess: [
    "readData",
    "manageFeatureDrafts",
    "manageFeatures",
    "manageArchetype",
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
  ExperimentsFullAccess: ["readData", "createAnalyses", "runQueries"],
  VisualEditorFullAccess: ["readData", "manageVisualChanges"],
  SuperDeleteReports: ["readData", "superDeleteReport"],
  DataSourcesFullAccess: [
    "readData",
    "createDatasources",
    "editDatasourceSettings",
    "runQueries",
  ],
  DataSourceConfiguration: ["readData", "editDatasourceSettings", "runQueries"],
  RunQueries: ["readData", "runQueries"],
  MetricsFullAccess: [
    "readData",
    "createMetrics",
    "runQueries",
    "createMetricGroups",
  ],
  FactTablesFullAccess: [
    "readData",
    "manageFactTables",
    "manageFactMetrics",
    "manageFactFilters",
    "runQueries",
  ],
  FactMetricsFullAccess: [
    "readData",
    "manageFactMetrics",
    "manageFactFilters",
    "runQueries",
  ],
  DimensionsFullAccess: ["readData", "createDimensions", "runQueries"],
  SegmentsFullAccess: ["readData", "createSegments", "runQueries"],
  IdeasFullAccess: ["readData", "createIdeas"],
  PresentationsFullAccess: ["readData", "createPresentations"],
  SDKPayloadPublish: ["readData", "publishFeatures", "runExperiments"],
  SDKConnectionsFullAccess: [
    "readData",
    "manageSDKConnections",
    "manageSDKWebhooks",
  ],
  DecisionCriteriaFullAccess: ["readData", "manageDecisionCriteria"],
  AttributesFullAccess: ["readData", "manageTargetingAttributes"],
  EnvironmentsFullAccess: ["readData", "manageEnvironments"],
  NamespacesFullAccess: ["readData", "manageNamespaces"],
  SavedGroupsFullAccess: ["readData", "manageSavedGroups"],
  SavedGroupsBypassSizeLimit: [
    "readData",
    "manageSavedGroups",
    "bypassSavedGroupSizeLimit",
  ],
  GeneralSettingsFullAccess: ["readData", "organizationSettings"],
  NorthStarMetricFullAccess: ["readData", "manageNorthStarMetric"],
  TeamManagementFullAccess: ["readData", "manageTeam"],
  ProjectsFullAccess: ["readData", "manageProjects"],
  TagsFullAccess: ["readData", "manageTags"],
  APIKeysFullAccess: ["readData", "manageApiKeys"],
  IntegrationsFullAccess: ["readData", "manageIntegrations"],
  EventWebhooksFullAccess: ["readData", "manageEventWebhooks", "viewAuditLog"],
  BillingFullAccess: ["readData", "manageBilling"],
  AuditLogsFullAccess: ["readData", "viewAuditLog"],
  CustomRolesFullAccess: ["readData", "manageTeam", "manageCustomRoles"],
  CustomFieldsFullAccess: ["readData", "manageCustomFields"],
  TemplatesFullAccess: ["readData", "manageTemplates"],
  GeneralDashboardsFullAccess: ["readData", "manageGeneralDashboards"],
  SqlExplorerFullAccess: ["readData", "runSqlExplorerQueries"],
  HoldoutsFullAccess: ["readData", "createAnalyses", "runQueries"],
  CustomHooksFullAccess: ["readData", "manageCustomHooks"],
  ManageOfficialResources: [
    "readData",
    "manageOfficialResources",
    "runQueries",
  ],
};

export const POLICY_DISPLAY_GROUPS: { name: string; policies: Policy[] }[] = [
  {
    name: "Global",
    policies: ["ReadData", "Comments"],
  },
  {
    name: "Features",
    policies: [
      "FeaturesFullAccess",
      "ArchetypesFullAccess",
      "FeaturesBypassApprovals",
    ],
  },
  {
    name: "Experiments",
    policies: [
      "ExperimentsFullAccess",
      "VisualEditorFullAccess",
      "SuperDeleteReports",
      "TemplatesFullAccess",
      "HoldoutsFullAccess",
    ],
  },
  {
    name: "Metrics and Data",
    policies: [
      "DataSourcesFullAccess",
      "DataSourceConfiguration",
      "RunQueries",
      "SqlExplorerFullAccess",
      "MetricsFullAccess",
      "FactTablesFullAccess",
      "FactMetricsFullAccess",
      "DimensionsFullAccess",
      "SegmentsFullAccess",
      "ManageOfficialResources",
    ],
  },
  {
    name: "Management",
    policies: ["IdeasFullAccess", "PresentationsFullAccess"],
  },
  {
    name: "SDK Configuration",
    policies: [
      "SDKPayloadPublish",
      "SDKConnectionsFullAccess",
      "AttributesFullAccess",
      "EnvironmentsFullAccess",
      "NamespacesFullAccess",
      "SavedGroupsFullAccess",
      "SavedGroupsBypassSizeLimit",
    ],
  },
  {
    name: "Settings",
    policies: [
      "GeneralSettingsFullAccess",
      "NorthStarMetricFullAccess",
      "TeamManagementFullAccess",
      "CustomRolesFullAccess",
      "CustomFieldsFullAccess",
      "ProjectsFullAccess",
      "TagsFullAccess",
      "APIKeysFullAccess",
      "IntegrationsFullAccess",
      "EventWebhooksFullAccess",
      "BillingFullAccess",
      "AuditLogsFullAccess",
      "DecisionCriteriaFullAccess",
    ],
  },
];

export const POLICY_METADATA_MAP: Record<
  Policy,
  {
    displayName: string;
    description: string;
    warning?: string;
  }
> = {
  ReadData: {
    displayName: "Read Data",
    description:
      "View all resources - features, metrics, experiments, data sources, etc.",
  },
  Comments: {
    displayName: "Comments",
    description: "Add comments to any resource",
  },
  FeaturesFullAccess: {
    displayName: "Features Full Access",
    description: "Create, edit, and delete feature flags",
  },
  ArchetypesFullAccess: {
    displayName: "Archetypes Full Access",
    description:
      "Create, edit, and delete saved User Archetypes for feature flag debugging",
  },
  FeaturesBypassApprovals: {
    displayName: "Features Bypass Approvals",
    description: "Bypass required approval checks for feature flag changes",
  },
  ExperimentsFullAccess: {
    displayName: "Experiments Full Access",
    description:
      "Create, edit, and delete experiments. Does not include Visual Editor access.",
  },
  VisualEditorFullAccess: {
    displayName: "Visual Editor Full Access",
    description: "Use the Visual Editor to implement experiment changes.",
  },
  SuperDeleteReports: {
    displayName: "Super Delete Reports",
    description:
      "Delete custom reports made by other users. Typically assigned to admins only.",
  },
  DataSourcesFullAccess: {
    displayName: "Data Sources Full Access",
    description: "Create, edit, and delete data sources",
  },
  DataSourceConfiguration: {
    displayName: "Data Source Configuration",
    description:
      "Edit existing data source configuration settings (identifier types, experiment assignment queries)",
  },
  RunQueries: {
    displayName: "Run Queries",
    description:
      "Execute queries against data sources. Required to refresh experiment results. Does not include SQL Explorer access.",
  },
  SqlExplorerFullAccess: {
    displayName: "SQL Explorer Full Access",
    description: "Create, run, edit, and delete SQL Explorer queries",
  },
  MetricsFullAccess: {
    displayName: "Metrics Full Access",
    description:
      "Create, edit, and delete regular metrics (does not include Fact Metrics)",
  },
  FactTablesFullAccess: {
    displayName: "Fact Tables Full Access",
    description: "Create, edit, and delete fact tables, metrics, and filters.",
  },
  FactMetricsFullAccess: {
    displayName: "Fact Metrics Full Access",
    description: "Create, edit, and delete fact metrics and filters.",
  },
  DimensionsFullAccess: {
    displayName: "Dimensions Full Access",
    description: "Create, edit, and delete dimensions",
  },
  SegmentsFullAccess: {
    displayName: "Segments Full Access",
    description: "Create, edit, and delete segments",
  },
  IdeasFullAccess: {
    displayName: "Ideas Full Access",
    description: "Create, edit, and delete ideas",
  },
  PresentationsFullAccess: {
    displayName: "Presentations Full Access",
    description: "Create, edit, and delete presentations",
  },
  SDKPayloadPublish: {
    displayName: "SDK Payload Publish",
    description:
      "Make changes that affect data sent to SDKs. For example: edit a saved group, toggle a feature flag, stop an experiment, etc.",
  },
  SDKConnectionsFullAccess: {
    displayName: "SDK Connections Full Access",
    description: "Create, edit, and delete SDK Connections",
  },
  AttributesFullAccess: {
    displayName: "Attributes Full Access",
    description: "Create, edit, and delete targeting attributes",
  },
  EnvironmentsFullAccess: {
    displayName: "Environments Full Access",
    description: "Create, edit, and delete environments",
  },
  NamespacesFullAccess: {
    displayName: "Namespaces Full Access",
    description: "Create, edit, and delete namespaces",
  },
  SavedGroupsFullAccess: {
    displayName: "Saved Groups Full Access",
    description: "Create, edit, and delete saved groups",
  },
  SavedGroupsBypassSizeLimit: {
    displayName: "Saved Groups Bypass Size Limit",
    description: "Bypass org-defined size limits for saved groups",
  },

  GeneralSettingsFullAccess: {
    displayName: "General Settings Full Access",
    description: "Edit organization general settings",
  },
  NorthStarMetricFullAccess: {
    displayName: "North Star Metric Full Access",
    description: "Configure North Star metrics",
  },
  TeamManagementFullAccess: {
    displayName: "Team Management Full Access",
    description:
      "Invite users, delete users, change user roles, add/remove users from teams.",
    warning: "Can be used to create new admin users",
  },
  ProjectsFullAccess: {
    displayName: "Projects Full Access",
    description: "Create, edit, and delete projects",
  },
  TagsFullAccess: {
    displayName: "Tags Full Access",
    description: "Create, edit, and delete tags",
  },
  APIKeysFullAccess: {
    displayName: "API Keys Full Access",
    description:
      "Create, edit, and delete API secret keys. Not required to create Personal Access Tokens.",
    warning: "Can be used to create an API Key with full admin permissions.",
  },
  IntegrationsFullAccess: {
    displayName: "Integrations Full Access",
    description: "Set up and configure integrations - GitHub, Vercel, etc.",
  },
  EventWebhooksFullAccess: {
    displayName: "Event Webhooks Full Access",
    description:
      "Create, edit, and delete event-based webhooks. Used for Slack/Discord notifications.",
  },
  BillingFullAccess: {
    displayName: "Billing Full Access",
    description:
      "View and edit license key. View invoices and update billing info.",
  },
  AuditLogsFullAccess: {
    displayName: "Audit Logs Full Access",
    description: "View and export audit logs",
  },
  CustomRolesFullAccess: {
    displayName: "Manage Custom Roles",
    description: "Create, edit, and delete custom roles",
  },
  CustomFieldsFullAccess: {
    displayName: "Manage Custom Fields",
    description: "Create, edit, and delete custom fields",
  },
  TemplatesFullAccess: {
    displayName: "Manage Templates",
    description: "Create, edit, and delete experiment templates",
  },
  DecisionCriteriaFullAccess: {
    displayName: "Decision Criteria Full Access",
    description:
      "Create, edit, and delete decision criteria, part of the experiment decision framework.",
  },
  HoldoutsFullAccess: {
    displayName: "Holdouts Full Access",
    description: "Create, edit, and delete holdouts",
  },
  CustomHooksFullAccess: {
    displayName: "Custom Hooks Full Access",
    description: "Create, edit, and delete custom hooks",
  },
  ManageOfficialResources: {
    displayName: "Manage Official Resources",
    description:
      "Create, edit, and delete official resources. For example: Manage resources like Fact Tables, Metrics, Segments, etc that have been marked as 'Official'.",
  },
  GeneralDashboardsFullAccess: {
    displayName: "General Dashboards Full Access",
    description: "Create, edit, and delete Product Analytics dashboards.",
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
      "SqlExplorerFullAccess",
      "MetricsFullAccess",
      "ExperimentsFullAccess",
      "VisualEditorFullAccess",
      "FactTablesFullAccess",
      "FactMetricsFullAccess",
      "DimensionsFullAccess",
      "SegmentsFullAccess",
      "IdeasFullAccess",
      "PresentationsFullAccess",
      "TagsFullAccess",
      "DataSourceConfiguration",
      "TemplatesFullAccess",
      "DecisionCriteriaFullAccess",
      "HoldoutsFullAccess",
      "GeneralDashboardsFullAccess",
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
      "SqlExplorerFullAccess",
      "MetricsFullAccess",
      "FactTablesFullAccess",
      "FactMetricsFullAccess",
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
      "TemplatesFullAccess",
      "DecisionCriteriaFullAccess",
      "HoldoutsFullAccess",
      "GeneralDashboardsFullAccess",
    ],
  },
  admin: {
    id: "admin",
    description:
      "All access + invite teammates and configure organization settings",
    policies: [...POLICIES],
  },
};

// Reserved role IDs that cannot be used by custom roles
// There are 2 legacy roles (designer/developer) that we also need to reserve
// This is because of JIT migrations performed in the organization object
export const RESERVED_ROLE_IDS = [
  ...Object.keys(DEFAULT_ROLES),
  "designer",
  "developer",
];

export const ENV_SCOPED_PERMISSIONS = [
  "publishFeatures",
  "manageEnvironments",
  "manageSDKConnections",
  "manageSDKWebhooks",
  "runExperiments",
] as const;

export const PROJECT_SCOPED_PERMISSIONS = [
  "readData",
  "addComments",
  "bypassApprovalChecks",
  "canReview",
  "manageFeatureDrafts",
  "manageFeatures",
  "manageArchetype",
  "manageProjects",
  "createAnalyses",
  "createSegments",
  "createIdeas",
  "createMetrics",
  "manageFactTables",
  "manageFactFilters",
  "manageFactMetrics",
  "createDatasources",
  "editDatasourceSettings",
  "runQueries",
  "runSqlExplorerQueries",
  "manageTargetingAttributes",
  "manageVisualChanges",
  "manageSavedGroups",
  "manageCustomFields",
  "manageTemplates",
  "manageExecReports",
  "manageCustomHooks",
  "manageGeneralDashboards",
  "manageOfficialResources",
  "bypassSavedGroupSizeLimit",
] as const;

export const GLOBAL_PERMISSIONS = [
  "readData",
  "createPresentations",
  "createDimensions",
  "createMetricGroups",
  "organizationSettings",
  "superDeleteReport",
  "manageTeam",
  "manageTags",
  "manageApiKeys",
  "manageIntegrations",
  "manageEventWebhooks",
  "manageBilling",
  "manageNorthStarMetric",
  "manageDecisionCriteria",
  "manageNamespaces",
  "manageCustomRoles",
  "manageCustomFields",
  "viewAuditLog",
] as const;

export const ALL_PERMISSIONS = [
  ...GLOBAL_PERMISSIONS,
  ...PROJECT_SCOPED_PERMISSIONS,
  ...ENV_SCOPED_PERMISSIONS,
];

export const READ_ONLY_PERMISSIONS = [
  "readData",
  "viewAuditLog",
  "runQueries",
  "runSqlExplorerQueries",
  "addComments",
];
