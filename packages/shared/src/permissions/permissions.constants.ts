import { DefaultMemberRole, Permission, Role } from "shared/types/organization";

export const POLICIES = [
  "ReadData",
  "Comments",
  "FlagsFullAccess",
  "FlagsCreate",
  "FlagsEditDrafts",
  "FlagsReview",
  "FlagsPublish",
  "FlagsRevert",
  "FlagsDelete",
  "FlagsBypassApprovals",
  "ArchetypesFullAccess",
  // Deprecated: merged into the Flags family. Kept resolvable for back-compat
  // and hidden from the role editor; they resolve through the map below.
  "FeaturesFullAccess",
  "FeaturesBypassApprovals",
  "ConstantsFullAccess",
  "ConfigsFullAccess",
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
  "ExperimentsPublish",
  "SDKPayloadPublish",
  "SDKConnectionsFullAccess",
  "AttributesFullAccess",
  "EnvironmentsFullAccess",
  "NamespacesFullAccess",
  "SavedGroupsFullAccess",
  "SavedGroupsCreate",
  "SavedGroupsEditDrafts",
  "SavedGroupsReview",
  "SavedGroupsPublish",
  "SavedGroupsRevert",
  "SavedGroupsDelete",
  "SavedGroupsBypassApprovals",
  "SavedGroupsBypassSizeLimit",
  "BypassSavedGroupSizeLimit",
  "GeneralSettingsFullAccess",
  "NorthStarMetricFullAccess",
  "TeamManagementFullAccess",
  "ProjectsFullAccess",
  "ProjectAdminAccess",
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
  "SessionReplayViewAccess",
  "SessionReplayFullAccess",
] as const;

export type Policy = (typeof POLICIES)[number];

// Policies retained only for back-compat after the Flags merge. They still
// resolve (mapped to the merged Flags atoms in POLICY_PERMISSION_MAP) so
// existing stored custom roles keep their exact access, but they are hidden
// from the role editor (excluded from POLICY_DISPLAY_GROUPS) and must not be
// offered for new selection.
export const DEPRECATED_POLICIES: Policy[] = [
  // Superseded by BypassSavedGroupSizeLimit, which grants only the bypass atom.
  // Stays resolvable as a superset: stored roles may rely on it for saved-group
  // management on its own.
  "SavedGroupsBypassSizeLimit",
  // Everything it granted is now expressed by the Feature Flags family plus
  // ExperimentsPublish, so it's hidden from the editor. Stays resolvable, since
  // stored roles rely on it for publish authority.
  "SDKPayloadPublish",
  "FeaturesFullAccess",
  "FeaturesBypassApprovals",
  "ConfigsFullAccess",
  "ConstantsFullAccess",
];

export const POLICY_PERMISSION_MAP: Record<Policy, Permission[]> = {
  ReadData: ["readData"],
  Comments: ["readData", "addComments"],
  // Archetypes are their own row in the editor, so they aren't bundled here.
  // (The deprecated FeaturesFullAccess shim below still grants manageArchetype,
  // because it did on main and stored roles rely on it.)
  FlagsFullAccess: [
    "readData",
    "createFeatures",
    "createConfigs",
    "createConstants",
    "deleteFeatures",
    "deleteConfigs",
    "deleteConstants",
    "editFeatureDrafts",
    "editConfigDrafts",
    "editConstantDrafts",
    "reviewFeatures",
    "reviewConfigs",
    "reviewConstants",
    "publishFeatures",
    "publishConfigs",
    "publishConstants",
    "revertFeatures",
    "revertConfigs",
    "revertConstants",
  ],
  // The lifecycle, one policy per action. Each bundles the three flag
  // entities, so an admin grants "may publish flags" without choosing between
  // Features, Configs and Constants — the split exists for the checks.
  FlagsCreate: [
    "readData",
    "createFeatures",
    "createConfigs",
    "createConstants",
  ],
  FlagsDelete: [
    "readData",
    "deleteFeatures",
    "deleteConfigs",
    "deleteConstants",
  ],
  FlagsEditDrafts: [
    "readData",
    "editFeatureDrafts",
    "editConfigDrafts",
    "editConstantDrafts",
  ],
  FlagsReview: [
    "readData",
    "reviewFeatures",
    "reviewConfigs",
    "reviewConstants",
  ],
  FlagsPublish: [
    "readData",
    "publishFeatures",
    "publishConfigs",
    "publishConstants",
  ],
  FlagsRevert: [
    "readData",
    "revertFeatures",
    "revertConfigs",
    "revertConstants",
  ],
  // An add-on, not a bundle: bypassing review isn't a lifecycle action, it changes
  // how the lifecycle behaves. Ticked alongside FlagsFullAccess rather than
  // repeating it. (The deprecated FeaturesBypassApprovals below stays a superset,
  // since stored roles rely on it granting access on its own.)
  FlagsBypassApprovals: [
    "readData",
    "bypassApprovalFeatures",
    "bypassApprovalConfigs",
    "bypassApprovalConstants",
  ],
  ArchetypesFullAccess: ["readData", "manageArchetype"],
  // Deprecated: mapped to this entity's own atoms to preserve legacy access
  // exactly. Legacy Features access never included publish, so publish/revert
  // are omitted. Pairing this with SDKPayloadPublish is the one legacy
  // combination that loses access on upgrade — see the note there.
  FeaturesFullAccess: [
    "readData",
    "createFeatures",
    "deleteFeatures",
    "editFeatureDrafts",
    "reviewFeatures",
    "manageArchetype",
  ],
  // Grants EVERY entity's bypass atom: the pre-split `bypassApprovalChecks` was
  // org-wide — main's config/constant adapters consult it directly — so dropping
  // any one of these quietly takes bypass away from a stored role on upgrade.
  FeaturesBypassApprovals: [
    "readData",
    "createFeatures",
    "deleteFeatures",
    "editFeatureDrafts",
    "reviewFeatures",
    "bypassApprovalFeatures",
    "bypassApprovalConfigs",
    "bypassApprovalConstants",
    "bypassApprovalSavedGroups",
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
  ExperimentsPublish: ["readData", "runExperiments"],
  // Deprecated. Mapped to exactly what it granted before the split — no revert:
  // main had no revert atom, and its revert endpoints demanded `manageFeatures`,
  // which this policy never carried. "Revert is a narrower publish" is true in
  // the abstract but would hand a deployment-only legacy role authority it never
  // had.
  //
  // Consequence, reviewed and accepted: a role holding this AND
  // FeaturesFullAccess could revert on main and no longer can. Policies grant
  // independently, so the only way to keep it is to put the revert atom on one
  // of them, which hands that policy alone authority it never had —
  // under-granting fails closed and an admin can add FlagsRevert. Pinned by
  // "does not let the deployment-only legacy role revert" in
  // shared/test/granular-flag-permissions.test.ts, whose BASELINE table carries
  // the full reasoning. Standard roles are unaffected (they carry
  // FlagsFullAccess).
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
  // Deprecated: superseded by the Flags policies. Each grants ONLY its own
  // entity's atoms — on main these were `manageConstants` / `manageConfigs`, so
  // granting the whole flag family here would hand a Configs-only role full
  // Feature Flag access on upgrade. Publish + revert are included because a
  // constant/config publish was gated by the same manage* atom as an edit.
  ConstantsFullAccess: [
    "readData",
    "createConstants",
    "deleteConstants",
    "editConstantDrafts",
    "reviewConstants",
    "publishConstants",
    "revertConstants",
  ],
  ConfigsFullAccess: [
    "readData",
    "createConfigs",
    "deleteConfigs",
    "editConfigDrafts",
    "reviewConfigs",
    "publishConfigs",
    "revertConfigs",
  ],
  SavedGroupsFullAccess: [
    "readData",
    "createSavedGroups",
    "deleteSavedGroups",
    "editSavedGroupDrafts",
    "reviewSavedGroups",
    "publishSavedGroups",
    "revertSavedGroups",
  ],
  SavedGroupsCreate: ["readData", "createSavedGroups"],
  SavedGroupsEditDrafts: ["readData", "editSavedGroupDrafts"],
  SavedGroupsReview: ["readData", "reviewSavedGroups"],
  SavedGroupsPublish: ["readData", "publishSavedGroups"],
  SavedGroupsRevert: ["readData", "revertSavedGroups"],
  SavedGroupsDelete: ["readData", "deleteSavedGroups"],
  // The saved-group half of the bypass add-on, mirroring FlagsBypassApprovals.
  SavedGroupsBypassApprovals: ["readData", "bypassApprovalSavedGroups"],
  BypassSavedGroupSizeLimit: ["readData", "bypassSavedGroupSizeLimit"],
  // Deprecated superset — see DEPRECATED_POLICIES.
  SavedGroupsBypassSizeLimit: [
    "readData",
    "createSavedGroups",
    "deleteSavedGroups",
    "editSavedGroupDrafts",
    "reviewSavedGroups",
    "publishSavedGroups",
    "revertSavedGroups",
    "bypassSavedGroupSizeLimit",
  ],
  GeneralSettingsFullAccess: ["readData", "organizationSettings"],
  NorthStarMetricFullAccess: ["readData", "manageNorthStarMetric"],
  TeamManagementFullAccess: ["readData", "manageTeam"],
  ProjectsFullAccess: [
    "readData",
    "manageProjects",
    "createProjects",
    "deleteProjects",
  ],
  ProjectAdminAccess: ["readData", "manageProjects"],
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
  SessionReplayViewAccess: ["readData", "viewSessionReplay"],
  SessionReplayFullAccess: [
    "readData",
    "viewSessionReplay",
    "deleteSessionReplay",
  ],
};

export const POLICY_DISPLAY_GROUPS: { name: string; policies: Policy[] }[] = [
  {
    name: "Global",
    policies: ["ReadData", "Comments"],
  },
  {
    name: "Feature Flags, Configs, and Constants",
    policies: [
      "FlagsFullAccess",
      "FlagsCreate",
      "FlagsEditDrafts",
      "FlagsReview",
      "FlagsPublish",
      "FlagsRevert",
      "FlagsDelete",
      "FlagsBypassApprovals",
      "ArchetypesFullAccess",
    ],
  },
  {
    name: "Saved Groups",
    policies: [
      "SavedGroupsFullAccess",
      "SavedGroupsCreate",
      "SavedGroupsEditDrafts",
      "SavedGroupsReview",
      "SavedGroupsPublish",
      "SavedGroupsRevert",
      "SavedGroupsDelete",
      "SavedGroupsBypassApprovals",
      "BypassSavedGroupSizeLimit",
    ],
  },
  {
    name: "Experiments",
    policies: [
      "ExperimentsFullAccess",
      "ExperimentsPublish",
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
    name: "Product Analytic Dashboards",
    policies: ["GeneralDashboardsFullAccess"],
  },
  {
    name: "Session Replay",
    policies: ["SessionReplayViewAccess", "SessionReplayFullAccess"],
  },
  {
    name: "SDK Configuration",
    policies: [
      "SDKConnectionsFullAccess",
      "AttributesFullAccess",
      "EnvironmentsFullAccess",
      "NamespacesFullAccess",
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
      "ProjectAdminAccess",
      "TagsFullAccess",
      "APIKeysFullAccess",
      "IntegrationsFullAccess",
      "EventWebhooksFullAccess",
      "BillingFullAccess",
      "AuditLogsFullAccess",
      "DecisionCriteriaFullAccess",
      "CustomHooksFullAccess",
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
      "View all resources — Feature Flags, metrics, experiments, Data Sources, etc.",
  },
  Comments: {
    displayName: "Comments",
    description: "Add comments to any resource",
  },
  FlagsFullAccess: {
    displayName: "Full access",
    description:
      "Create, edit, review, publish, revert, and delete Feature Flags, Constants, and Configs",
  },
  FlagsCreate: {
    displayName: "Create",
    description:
      "Create new Feature Flags, Constants, and Configs (environment-scoped)",
  },
  FlagsEditDrafts: {
    displayName: "Edit",
    description:
      "Create, edit, and discard drafts, and request review. Drafts reach no one until published.",
  },
  FlagsReview: {
    displayName: "Review",
    description: "Approve or request changes on revisions",
  },
  FlagsPublish: {
    displayName: "Publish",
    description:
      "Put changes in front of users: publish a revision, save directly, unarchive, or toggle an environment (environment-scoped)",
  },
  FlagsRevert: {
    displayName: "Revert",
    description:
      "Revert to a previously published revision (environment-scoped)",
  },
  FlagsDelete: {
    displayName: "Archive & delete",
    description:
      "Archive (environment-scoped) or delete Feature Flags, Constants, and Configs. Deleting is not environment-scoped — an archived entity already serves nowhere.",
  },
  FlagsBypassApprovals: {
    displayName: "Bypass draft approvals",
    description:
      "Publish without the required draft review, force-merge an out-of-date draft, and unlock a locked Config. Applies to Feature Flags, Configs, and Constants. Schema validation and Custom Hooks still run by default; over the REST API this access also permits forcing past them with `skipSchemaValidation` or `skipHooks`.",
  },
  FeaturesFullAccess: {
    displayName: "Features Full Access",
    description: "Create, edit, and delete Feature Flags",
  },
  ArchetypesFullAccess: {
    displayName: "Archetypes",
    description:
      "Create, edit, and delete saved User Archetypes for Feature Flag debugging",
  },
  FeaturesBypassApprovals: {
    displayName: "Features Bypass Approvals",
    description: "Bypass required approval checks for Feature Flag changes",
  },
  ConstantsFullAccess: {
    displayName: "Constants Full Access",
    description: "Create, edit, and delete Constants",
  },
  ConfigsFullAccess: {
    displayName: "Configs Full Access",
    description: "Create, edit, and delete Configs",
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
    description: "Create, edit, and delete Data Sources",
  },
  DataSourceConfiguration: {
    displayName: "Data Source Configuration",
    description:
      "Edit existing Data Source configuration settings (identifier types, experiment assignment queries)",
  },
  RunQueries: {
    displayName: "Run Queries",
    description:
      "Execute queries against Data Sources. Required to refresh experiment results. Does not include SQL Explorer access.",
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
    description: "Create, edit, and delete Fact Metrics and filters.",
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
  ExperimentsPublish: {
    displayName: "Experiments Publish",
    description:
      "Start and stop experiments, which changes what is sent to SDKs.",
  },
  SDKPayloadPublish: {
    displayName: "SDK Payload Publish",
    description:
      "Publish and revert changes that affect data sent to SDKs. For example: publish a revision, toggle a Feature Flag, revert to a previously published revision, stop an experiment.",
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
    displayName: "Full access",
    description:
      "Create, edit, review, publish, revert, and delete Saved Groups",
  },
  SavedGroupsCreate: {
    displayName: "Create",
    description: "Create new Saved Groups",
  },
  SavedGroupsEditDrafts: {
    displayName: "Edit",
    description:
      "Create, edit, and discard Saved Group drafts, and request review. Drafts reach no one until published.",
  },
  SavedGroupsReview: {
    displayName: "Review",
    description: "Approve or request changes on revisions",
  },
  SavedGroupsPublish: {
    displayName: "Publish",
    description:
      "Put changes in front of users: publish a revision, save directly, or unarchive",
  },
  SavedGroupsRevert: {
    displayName: "Revert",
    description: "Revert to a previously published revision",
  },
  SavedGroupsDelete: {
    displayName: "Archive & delete",
    description: "Archive or delete Saved Groups",
  },
  SavedGroupsBypassApprovals: {
    displayName: "Bypass draft approvals",
    description:
      "Publish without the required draft review, and force-merge an out-of-date draft",
  },
  BypassSavedGroupSizeLimit: {
    displayName: "Bypass size limit",
    description: "Exceed the organization's size limits for a Saved Group",
  },
  SavedGroupsBypassSizeLimit: {
    displayName: "Saved Groups Bypass Size Limit",
    description: "Bypass org-defined size limits for Saved Groups",
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
    description:
      "Create, edit, and delete projects and change project roles for other members. Can be applied at the global or project level.",
    warning:
      "Can be used to create new project admins and adjust project roles for other members",
  },
  ProjectAdminAccess: {
    displayName: "Project Admin Access",
    description:
      "Manage project settings and change project roles for other members.",
    warning:
      "Can be used to create new project admins and adjust project roles for other members",
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
    description: "Create, edit, and delete Experiment Templates",
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
  SessionReplayViewAccess: {
    displayName: "Session Replay View Access",
    description: "View and play back recorded user sessions.",
    warning:
      "Recordings can contain sensitive user data. Grant only to roles with a need to view replays.",
  },
  SessionReplayFullAccess: {
    displayName: "Session Replay Full Access",
    description:
      "View, play back, and delete recorded user sessions (single, bulk, and DSR-driven deletions).",
    warning:
      "Includes the ability to permanently delete recorded sessions. Recordings can contain sensitive user data.",
  },
};

/**
 * The parts of a bundled policy, for the role editor's drill-down. A policy with
 * one atom isn't listed: expanding it would just restate the row above.
 */
export const POLICY_PARTS: Partial<Record<Policy, Policy[]>> = {
  FlagsFullAccess: [
    "FlagsCreate",
    "FlagsEditDrafts",
    "FlagsReview",
    "FlagsPublish",
    "FlagsRevert",
    "FlagsDelete",
  ],
  SavedGroupsFullAccess: [
    "SavedGroupsCreate",
    "SavedGroupsEditDrafts",
    "SavedGroupsReview",
    "SavedGroupsPublish",
    "SavedGroupsRevert",
    "SavedGroupsDelete",
  ],
};

export const DEFAULT_ROLES: Record<DefaultMemberRole, Role> = {
  noaccess: {
    id: "noaccess",
    displayName: "No Access",
    description:
      "Cannot view any features or experiments. Most useful when combined with project-scoped roles.",
    policies: [],
  },
  readonly: {
    id: "readonly",
    displayName: "Read Only",
    description: "View all features and experiment results",
    policies: ["ReadData"],
  },
  collaborator: {
    id: "collaborator",
    displayName: "Collaborator",
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
    displayName: "Visual Editor",
    description: "Make visual changes for an experiment",
    policies: ["ReadData", "VisualEditorFullAccess"],
  },
  engineer: {
    id: "engineer",
    displayName: "Engineer",
    description: "Manage features",
    policies: [
      "ReadData",
      "Comments",
      "FlagsFullAccess",
      "ArchetypesFullAccess",
      "VisualEditorFullAccess",
      "IdeasFullAccess",
      "PresentationsFullAccess",
      "ExperimentsPublish",
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
    displayName: "Analyst",
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
    displayName: "Experimenter",
    description: "Manage features AND Analyze experiments",
    policies: [
      "ReadData",
      "Comments",
      "FlagsFullAccess",
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
      "ExperimentsPublish",
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
  gbDefault_projectAdmin: {
    id: "gbDefault_projectAdmin",
    displayName: "Project Admin",
    description: "Manage project settings and project member's project role.",
    policies: [
      "ReadData",
      "Comments",
      "FlagsFullAccess",
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
      "ExperimentsPublish",
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
      // Both halves of the bypass add-on: before the split a single atom
      // covered saved groups too, and a Project Admin relied on it.
      "FlagsBypassApprovals",
      "SavedGroupsBypassApprovals",
      "ProjectAdminAccess",
    ],
  },
  admin: {
    id: "admin",
    displayName: "Admin",
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
  // Everything on a flag entity that touches live state. The caller supplies the
  // footprint; NO_ENVIRONMENT_BINDING means the change has no intrinsic
  // environment (a base Config, a Constant's base value).
  "createFeatures",
  "deleteFeatures",
  "publishFeatures",
  "revertFeatures",
  "createConfigs",
  "deleteConfigs",
  "publishConfigs",
  "revertConfigs",
  "createConstants",
  "deleteConstants",
  "publishConstants",
  "revertConstants",
  "manageEnvironments",
  "manageSDKConnections",
  "manageSDKWebhooks",
  "runExperiments",
] as const;

export const PROJECT_SCOPED_PERMISSIONS = [
  "readData",
  "addComments",
  "editFeatureDrafts",
  "reviewFeatures",
  "bypassApprovalFeatures",
  "editConfigDrafts",
  "reviewConfigs",
  "bypassApprovalConfigs",
  "editConstantDrafts",
  "reviewConstants",
  "bypassApprovalConstants",
  "manageArchetype",
  "manageProjects",
  "createProjects",
  "deleteProjects",
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
  "createSavedGroups",
  "deleteSavedGroups",
  "editSavedGroupDrafts",
  "reviewSavedGroups",
  "publishSavedGroups",
  "revertSavedGroups",
  "bypassApprovalSavedGroups",
  "manageCustomFields",
  "manageTemplates",
  "manageExecReports",
  "manageCustomHooks",
  "manageGeneralDashboards",
  "manageOfficialResources",
  "bypassSavedGroupSizeLimit",
  "viewSessionReplay",
  "deleteSessionReplay",
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
