import { DashboardInterface } from "shared/enterprise";
import { FeatureInterface } from "shared/types/feature";
import { MetricInterface } from "shared/types/metric";
import {
  EnvScopedPermission,
  Environment,
  GlobalPermission,
  Permission,
  ProjectScopedPermission,
  SDKAttribute,
  UserPermissions,
} from "shared/types/organization";
import {
  FactMetricInterface,
  FactTableInterface,
  UpdateFactTableProps,
} from "shared/types/fact-table";
import { ExecReportInterface } from "shared/types/exec-report";
import {
  ExperimentInterface,
  ExperimentTemplateInterface,
  UpdateTemplateProps,
} from "shared/types/experiment";
import { DataSourceInterface } from "shared/types/datasource";
import { UpdateProps } from "shared/types/base-model";
import { SegmentInterface } from "shared/types/segment";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { IdeaInterface } from "shared/types/idea";
import { ArchetypeInterface } from "shared/types/archetype";
import { SavedGroupInterface } from "shared/types/saved-group";
import { ConstantInterface } from "shared/types/constant";
import { ConfigInterface } from "shared/types/config";
import { CustomHookInterface } from "../validators/custom-hooks";
import { ContextualBanditInterface } from "../validators/contextual-bandit";
import { EventForwarderConfigInterface } from "../validators/event-forwarder-config";
import { HoldoutInterface } from "../validators/holdout";
import type { ExplorationDataset } from "../validators/product-analytics";
import { PermissionError, isEventForwarderEventsFactTable } from "../util/";
// Specific module, not the util barrel: the barrel imports back from
// shared/permissions, and the require cycle leaves re-exports uninitialized.
import {
  getTargetingProjectIds,
  TargetingScopedEntity,
} from "../util/features";
import type { ReviewAuthorityFootprint } from "../util/features";
import {
  envsAllowedBy,
  hasUnrestrictedEnvAuthority,
} from "./permissions.utils";
// Type-only: erased at runtime, so no cycle back through the util barrel.
import { READ_ONLY_PERMISSIONS } from "./permissions.constants";
import {
  NO_ENVIRONMENT_BINDING,
  revisionActionPermission,
  RevisionAction,
  RevisionModel,
} from "./revisionPermissions";

type NotificationEvent = {
  containsSecrets: boolean;
  projects: string[];
};

// The Event Forwarder Events fact table is `managedBy: "api"` but is
// intentionally editable and deletable by users for now, so it skips the
// manageOfficialResources checks below.
function isEventForwarderManagedFactTable(
  factTable: Partial<
    Pick<FactTableInterface, "id" | "managedBy" | "datasource">
  >,
): boolean {
  if (!factTable.id || !factTable.datasource) return false;
  return isEventForwarderEventsFactTable(
    { id: factTable.id, managedBy: factTable.managedBy },
    factTable.datasource,
  );
}

// "everywhere"/"unbound" → [] (fail closed); "any" → null (not sanctioning).
function footprintEnvironments(
  footprint: ReviewAuthorityFootprint,
): string[] | null {
  if (footprint.scope === "environments") return footprint.environments;
  return footprint.scope === "any" ? null : [];
}

export class Permissions {
  private userPermissions: UserPermissions;
  constructor(permissions: UserPermissions) {
    this.userPermissions = permissions;
  }

  //Global Permissions
  public canCreatePresentation = (): boolean => {
    return this.checkGlobalPermission("createPresentations");
  };

  public canUpdatePresentation = (): boolean => {
    return this.checkGlobalPermission("createPresentations");
  };

  public canDeletePresentation = (): boolean => {
    return this.checkGlobalPermission("createPresentations");
  };

  public canCreateDimension = (): boolean => {
    return this.checkGlobalPermission("createDimensions");
  };

  public canUpdateDimension = (): boolean => {
    return this.checkGlobalPermission("createDimensions");
  };

  public canDeleteDimension = (): boolean => {
    return this.checkGlobalPermission("createDimensions");
  };

  public canViewEventWebhook = (): boolean => {
    return this.checkGlobalPermission("manageEventWebhooks");
  };

  public canCreateEventWebhook = (): boolean => {
    return this.checkGlobalPermission("manageEventWebhooks");
  };

  public canUpdateEventWebhook = (): boolean => {
    return this.checkGlobalPermission("manageEventWebhooks");
  };

  public canDeleteEventWebhook = (): boolean => {
    return this.checkGlobalPermission("manageEventWebhooks");
  };

  public canCreateAndUpdateTag = (): boolean => {
    return this.checkGlobalPermission("manageTags");
  };

  public canDeleteTag = (): boolean => {
    return this.checkGlobalPermission("manageTags");
  };

  public canManageBilling = (): boolean => {
    return this.checkGlobalPermission("manageBilling");
  };

  public canViewUsage = (): boolean => {
    // TODO: separate this from billing?
    return this.checkGlobalPermission("manageBilling");
  };

  public canManageIntegrations = (): boolean => {
    return this.checkGlobalPermission("manageIntegrations");
  };

  public canCreateApiKey = (): boolean => {
    return this.checkGlobalPermission("manageApiKeys");
  };

  public canDeleteApiKey = (): boolean => {
    return this.checkGlobalPermission("manageApiKeys");
  };

  public canManageTeam = (): boolean => {
    return this.checkGlobalPermission("manageTeam");
  };

  public canCreateMetricGroup = (): boolean => {
    return this.checkGlobalPermission("createMetricGroups");
  };

  public canUpdateMetricGroup = (): boolean => {
    return this.checkGlobalPermission("createMetricGroups");
  };

  public canDeleteMetricGroup = (): boolean => {
    return this.checkGlobalPermission("createMetricGroups");
  };

  public canViewSessionReplay = (
    session?: { projects?: string[] } | null,
  ): boolean => {
    return this.checkProjectFilterPermission(
      { projects: session?.projects },
      "viewSessionReplay",
    );
  };

  public canDeleteSessionReplay = (
    session?: { projects?: string[] } | null,
  ): boolean => {
    return this.checkProjectFilterPermission(
      { projects: session?.projects },
      "deleteSessionReplay",
    );
  };

  public canManageOrgSettings = (): boolean => {
    return this.checkGlobalPermission("organizationSettings");
  };

  public canSuperDeleteReport = (): boolean => {
    return this.checkGlobalPermission("superDeleteReport");
  };

  public canManageNorthStarMetric = (): boolean => {
    return this.checkGlobalPermission("manageNorthStarMetric");
  };

  public canViewEvent = (event: NotificationEvent): boolean => {
    // Contains secrets (or is an old event where we weren't tracking this field yet)
    if (event.containsSecrets !== false) {
      return this.canViewAuditLogs();
    }

    return this.canReadMultiProjectResource(event.projects || []);
  };

  public canViewAuditLogs = (): boolean => {
    return this.checkGlobalPermission("viewAuditLog");
  };

  public canCreateNamespace = (): boolean => {
    return this.checkGlobalPermission("manageNamespaces");
  };

  public canUpdateNamespace = (): boolean => {
    return this.checkGlobalPermission("manageNamespaces");
  };

  public canDeleteNamespace = (): boolean => {
    return this.checkGlobalPermission("manageNamespaces");
  };

  //Project Permissions
  public canCreateOfficialResources = (
    resource: Pick<
      | SegmentInterface
      | FactTableInterface
      | FactMetricInterface
      | MetricInterface,
      "projects"
    >,
  ): boolean => {
    return this.checkProjectFilterPermission(
      resource,
      "manageOfficialResources",
    );
  };

  public canUpdateOfficialResources = (
    existing: Pick<
      | SegmentInterface
      | FactTableInterface
      | FactMetricInterface
      | MetricInterface,
      "projects"
    >,
    updates: Pick<
      | SegmentInterface
      | FactTableInterface
      | FactMetricInterface
      | MetricInterface,
      "projects"
    >,
  ): boolean => {
    return this.checkProjectFilterUpdatePermission(
      existing,
      updates,
      "manageOfficialResources",
    );
  };

  public canDeleteOfficialResources = (
    resource: Pick<
      | SegmentInterface
      | FactTableInterface
      | FactMetricInterface
      | MetricInterface,
      "projects"
    >,
  ): boolean => {
    return this.checkProjectFilterPermission(
      resource,
      "manageOfficialResources",
    );
  };

  public canCreateSegment = (
    segment: Pick<SegmentInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(segment, "createSegments");
  };

  public canUpdateSegment = (
    existing: Pick<SegmentInterface, "projects">,
    updates: Pick<SegmentInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterUpdatePermission(
      existing,
      updates,
      "createSegments",
    );
  };

  public canDeleteSegment = (
    segment: Pick<SegmentInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(segment, "createSegments");
  };

  public canCreateVisualChange = (
    experiment: Pick<ExperimentInterface, "project">,
  ): boolean => {
    return this.checkProjectFilterPermission(
      { projects: experiment.project ? [experiment.project] : [] },
      "manageVisualChanges",
    );
  };

  public canUpdateVisualChange = (
    experiment: Pick<ExperimentInterface, "project">,
  ): boolean => {
    return this.checkProjectFilterPermission(
      { projects: experiment.project ? [experiment.project] : [] },
      "manageVisualChanges",
    );
  };

  // Frontend helper to gate "Add Attribute" UI.
  // Pass allProjects on list pages where "All Projects" may be selected;
  // omit it when checking a specific resource's project or global-only access.
  public canViewAttributeModal = (
    project?: string,
    allProjects?: { id: string }[],
  ): boolean => {
    if (!project && allProjects?.length) {
      // Allow if the user can create an attribute with no project (e.g. a
      // global admin). Checking that first means a non-creatable project (like
      // the read-only sample-data project) can't gate the CTA when it's the
      // only project.
      return (
        this.canCreateAttribute({ projects: [] }) ||
        allProjects.some((p) => this.canCreateAttribute({ projects: [p.id] }))
      );
    }
    return this.canCreateAttribute({ projects: project ? [project] : [] });
  };

  public canCreateAttribute = (
    attribute: Pick<SDKAttribute, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(
      attribute,
      "manageTargetingAttributes",
    );
  };

  public canUpdateAttribute = (
    existing: Pick<SDKAttribute, "projects">,
    updates: Pick<SDKAttribute, "projects">,
  ): boolean => {
    return this.checkProjectFilterUpdatePermission(
      existing,
      updates,
      "manageTargetingAttributes",
    );
  };

  public canDeleteAttribute = (
    attribute: Pick<SDKAttribute, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(
      attribute,
      "manageTargetingAttributes",
    );
  };

  // The single entry point for a revisioned entity's lifecycle permissions.
  // Maps (model, action) -> atom+scope via REVISION_PERMISSIONS. Env-scoped
  // actions gate on `environments`; project-scoped actions ignore them.
  public canRevisionAction = (
    model: RevisionModel,
    action: RevisionAction,
    obj: { project?: string; projects?: string[] },
    // `null` = no environment constraint. `[]` = unbound, which fails closed.
    environments: string[] | null = [],
  ): boolean => {
    const projects = obj.projects ?? (obj.project ? [obj.project] : []);
    const { permission, scope } = revisionActionPermission(model, action);
    if (scope === "environment") {
      if (environments === null) {
        return this.checkProjectFilterPermission(
          { projects },
          permission as ProjectScopedPermission,
        );
      }
      // Unbound changes take authority no environment limit restricts.
      if (action === "review" && !environments.length) {
        return this.checkUnrestrictedEnvAuthority({ projects }, permission);
      }
      return this.checkEnvFilterPermission(
        { projects },
        environments,
        permission as EnvScopedPermission,
      );
    }
    return this.checkProjectFilterPermission(
      { projects },
      permission as ProjectScopedPermission,
    );
  };

  // Frontend helper to gate "Create Feature" UI.
  // Pass allProjects on list pages where "All Projects" may be selected;
  // omit it when checking a specific resource's project or global-only access.
  public canViewFeatureModal = (
    project?: string,
    allProjects?: { id: string }[],
  ): boolean => {
    if (!project && allProjects?.length) {
      // Allow if the user has the permission with no project (e.g. a global
      // admin). Checking that first means a non-creatable project (like the
      // read-only sample-data project) can't gate the CTA when it's the only
      // project.
      return (
        this.canCreateFeature({ project: undefined }, NO_ENVIRONMENT_BINDING) ||
        allProjects.some((p) =>
          this.canCreateFeature({ project: p.id }, NO_ENVIRONMENT_BINDING),
        )
      );
    }
    return this.canCreateFeature({ project }, NO_ENVIRONMENT_BINDING);
  };

  // Creating a flag writes live state, so it takes the publish-class create
  // atom with the environments the new flag is enabled in. The create UI passes
  // NO_ENVIRONMENT_BINDING (no payload yet); the endpoint re-checks the real
  // footprint on submit.
  public canCreateFeature = (
    feature: Pick<FeatureInterface, "project">,
    environments: string[],
  ): boolean => {
    return this.canRevisionAction(
      "feature",
      "create",
      { projects: feature.project ? [feature.project] : [] },
      environments,
    );
  };

  /** Archiving and deleting both take the flag out of service in `environments`. */
  public canDeleteFeature = (
    feature: Pick<FeatureInterface, "project">,
    environments: string[],
  ): boolean => {
    return this.canRevisionAction(
      "feature",
      "delete",
      { projects: feature.project ? [feature.project] : [] },
      environments,
    );
  };

  // Revert a feature to a previously-published revision. Env-scoped: gate on the
  // environments the revert would change.
  public canRevertFeature = (
    feature: Pick<FeatureInterface, "project">,
    environments: string[],
  ): boolean => {
    return this.canRevisionAction(
      "feature",
      "revert",
      { projects: feature.project ? [feature.project] : [] },
      environments,
    );
  };

  // Frontend helper to gate "Create Experiment" UI.
  // Pass allProjects on list pages where "All Projects" may be selected;
  // omit it when checking a specific resource's project or global-only access.
  public canViewExperimentModal = (
    project?: string,
    allProjects?: { id: string }[],
  ): boolean => {
    if (!project && allProjects?.length) {
      // Allow if the user has the permission with no project (e.g. a global
      // admin). Checking that first means a non-creatable project (like the
      // read-only sample-data project) can't gate the CTA when it's the only
      // project.
      return (
        this.checkProjectFilterPermission({ projects: [] }, "createAnalyses") ||
        allProjects.some((p) =>
          this.checkProjectFilterPermission(
            { projects: [p.id] },
            "createAnalyses",
          ),
        )
      );
    }
    return this.checkProjectFilterPermission(
      { projects: project ? [project] : [] },
      "createAnalyses",
    );
  };

  public canCreateExperiment = (
    experiment: Pick<ExperimentInterface, "project">,
  ): boolean => {
    return this.checkProjectFilterPermission(
      {
        projects: experiment.project ? [experiment.project] : [],
      },
      "createAnalyses",
    );
  };

  public canUpdateExperiment = (
    existing: Pick<ExperimentInterface, "project">,
    updated: Pick<ExperimentInterface, "project">,
  ): boolean => {
    return this.checkProjectFilterUpdatePermission(
      { projects: existing.project ? [existing.project] : [] },
      "project" in updated ? { projects: [updated.project || ""] } : {},
      "createAnalyses",
    );
  };

  public canDeleteExperiment = (
    experiment: Pick<ExperimentInterface, "project">,
  ): boolean => {
    return this.checkProjectFilterPermission(
      { projects: experiment.project ? [experiment.project] : [] },
      "createAnalyses",
    );
  };

  public canViewContextualBanditModal = (
    project?: string,
    allProjects?: { id: string }[],
  ): boolean => {
    if (!project && allProjects?.length) {
      return allProjects.some((p) =>
        this.checkProjectFilterPermission(
          { projects: [p.id] },
          "createAnalyses",
        ),
      );
    }
    return this.checkProjectFilterPermission(
      { projects: project ? [project] : [] },
      "createAnalyses",
    );
  };

  public canCreateContextualBandit = (
    cb: Pick<ContextualBanditInterface, "project">,
  ): boolean => {
    return this.checkProjectFilterPermission(
      { projects: cb.project ? [cb.project] : [] },
      "createAnalyses",
    );
  };

  public canUpdateContextualBandit = (
    existing: Pick<ContextualBanditInterface, "project">,
    updated: Pick<ContextualBanditInterface, "project">,
  ): boolean => {
    return this.checkProjectFilterUpdatePermission(
      { projects: existing.project ? [existing.project] : [] },
      "project" in updated ? { projects: [updated.project || ""] } : {},
      "createAnalyses",
    );
  };

  public canDeleteContextualBandit = (
    cb: Pick<ContextualBanditInterface, "project">,
  ): boolean => {
    return this.checkProjectFilterPermission(
      { projects: cb.project ? [cb.project] : [] },
      "createAnalyses",
    );
  };

  public canRunContextualBandit = (
    cb: Pick<ContextualBanditInterface, "project">,
    environments: string[],
  ): boolean => {
    return this.checkEnvFilterPermission(
      { projects: cb.project ? [cb.project] : [] },
      environments,
      "runExperiments",
    );
  };

  public canRunContextualBanditQueries = (
    datasource: Pick<DataSourceInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(datasource, "runQueries");
  };

  // Frontend helper to gate "Create Holdout" UI.
  // Pass allProjects on list pages where "All Projects" may be selected;
  // omit it when checking a specific resource's project or global-only access.
  public canViewHoldoutModal = (
    project?: string,
    allProjects?: { id: string }[],
  ): boolean => {
    if (!project && allProjects?.length) {
      // Allow if the user can create a holdout with no project (e.g. a global
      // admin). Checking that first means a non-creatable project (like the
      // read-only sample-data project) can't gate the CTA when it's the only
      // project.
      return (
        this.canCreateHoldout({ projects: [] }) ||
        allProjects.some((p) => this.canCreateHoldout({ projects: [p.id] }))
      );
    }
    return this.canCreateHoldout({ projects: project ? [project] : [] });
  };

  public canCreateHoldout = (
    holdout: Pick<HoldoutInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(
      { projects: holdout.projects || [] },
      "createAnalyses",
    );
  };

  public canUpdateHoldout = (
    existing: Pick<HoldoutInterface, "projects">,
    updated: Pick<HoldoutInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterUpdatePermission(
      { projects: existing.projects || [] },
      "projects" in updated ? { projects: updated.projects } : {},
      "createAnalyses",
    );
  };

  public canDeleteHoldout = (
    holdout: Pick<HoldoutInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(
      { projects: holdout.projects || [] },
      "createAnalyses",
    );
  };

  // Frontend helper to gate "Create Experiment Template" UI.
  // Pass allProjects on list pages where "All Projects" may be selected;
  // omit it when checking a specific resource's project or global-only access.
  public canViewExperimentTemplateModal = (
    project?: string,
    allProjects?: { id: string }[],
  ): boolean => {
    if (!project && allProjects?.length) {
      // Allow if the user has the permission with no project (e.g. a global
      // admin). Checking that first means a non-creatable project (like the
      // read-only sample-data project) can't gate the CTA when it's the only
      // project.
      return (
        this.checkProjectFilterPermission(
          { projects: [] },
          "manageTemplates",
        ) ||
        allProjects.some((p) =>
          this.checkProjectFilterPermission(
            { projects: [p.id] },
            "manageTemplates",
          ),
        )
      );
    }
    return this.checkProjectFilterPermission(
      { projects: project ? [project] : [] },
      "manageTemplates",
    );
  };

  public canCreateExperimentTemplate = (
    template: Pick<ExperimentTemplateInterface, "project">,
  ): boolean => {
    return this.checkProjectFilterPermission(
      {
        projects: template.project ? [template.project] : [],
      },
      "manageTemplates",
    );
  };

  public canUpdateExperimentTemplate = (
    existing: Pick<ExperimentTemplateInterface, "project">,
    updated: UpdateTemplateProps,
  ): boolean => {
    return this.checkProjectFilterUpdatePermission(
      { projects: existing.project ? [existing.project] : [] },
      "project" in updated ? { projects: [updated.project || ""] } : {},
      "manageTemplates",
    );
  };

  public canDeleteExperimentTemplate = (
    template: Pick<ExperimentTemplateInterface, "project">,
  ): boolean => {
    return this.checkProjectFilterPermission(
      {
        projects: template.project ? [template.project] : [],
      },
      "manageTemplates",
    );
  };

  public canCreateDecisionCriteria = (): boolean => {
    return this.checkGlobalPermission("manageDecisionCriteria");
  };

  public canUpdateDecisionCriteria = (): boolean => {
    return this.checkGlobalPermission("manageDecisionCriteria");
  };

  public canDeleteDecisionCriteria = (): boolean => {
    return this.checkGlobalPermission("manageDecisionCriteria");
  };

  // This is a helper method to use on the frontend to determine whether or not to show certain UI elements
  public canViewReportModal = (project?: string): boolean => {
    return this.checkProjectFilterPermission(
      {
        projects: project ? [project] : [],
      },
      "createAnalyses",
    );
  };
  // reports don't have projects, but their connected experiments do
  public canCreateReport = (
    connectedExperiment: Pick<ExperimentInterface, "project">,
  ): boolean => {
    return this.checkProjectFilterPermission(
      {
        projects: connectedExperiment.project
          ? [connectedExperiment.project]
          : [],
      },
      "createAnalyses",
    );
  };

  // reports don't have projects, but their connected experiments do
  public canUpdateReport = (
    connectedExperiment: Pick<ExperimentInterface, "project">,
  ): boolean => {
    return this.checkProjectFilterPermission(
      {
        projects: connectedExperiment.project
          ? [connectedExperiment.project]
          : [],
      },
      "createAnalyses",
    );
  };

  // reports don't have projects, but their connected experiments do
  public canDeleteReport = (
    connectedExperiment: Pick<ExperimentInterface, "project">,
  ): boolean => {
    return this.checkProjectFilterPermission(
      {
        projects: connectedExperiment.project
          ? [connectedExperiment.project]
          : [],
      },
      "createAnalyses",
    );
  };

  public canCreateAnalyses = (projects?: string[]): boolean => {
    return this.checkProjectFilterPermission(
      {
        projects: projects ? projects : [],
      },
      "createAnalyses",
    );
  };

  // This is a helper method to use on the frontend to determine whether or not to show certain UI elements
  // Frontend helper to gate "Create Idea" UI.
  // Pass allProjects on list pages where "All Projects" may be selected;
  // omit it when checking a specific resource's project or global-only access.
  public canViewIdeaModal = (
    project?: string,
    allProjects?: { id: string }[],
  ): boolean => {
    if (!project && allProjects?.length) {
      // Allow if the user can create an idea with no project (e.g. a global
      // admin). Checking that first means a non-creatable project (like the
      // read-only sample-data project) can't gate the CTA when it's the only
      // project.
      return (
        this.canCreateIdea({ project: "" }) ||
        allProjects.some((p) => this.canCreateIdea({ project: p.id }))
      );
    }
    return this.canCreateIdea({ project });
  };

  public canCreateIdea = (idea: Pick<IdeaInterface, "project">): boolean => {
    return this.checkProjectFilterPermission(
      {
        projects: idea.project ? [idea.project] : [],
      },
      "createIdeas",
    );
  };

  public canUpdateIdea = (
    existing: Pick<IdeaInterface, "project">,
    updated: Pick<IdeaInterface, "project">,
  ): boolean => {
    return this.checkProjectFilterUpdatePermission(
      { projects: existing.project ? [existing.project] : [] },
      "project" in updated ? { projects: [updated.project || ""] } : {},
      "createIdeas",
    );
  };

  public canDeleteIdea = (idea: Pick<IdeaInterface, "project">): boolean => {
    return this.checkProjectFilterPermission(
      { projects: idea.project ? [idea.project] : [] },
      "createIdeas",
    );
  };

  public canCreateArchetype = (
    archetype: Pick<ArchetypeInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(
      { projects: archetype?.projects ? archetype.projects : [] },
      "manageArchetype",
    );
  };

  public canUpdateArchetype = (
    archetype: Pick<ArchetypeInterface, "projects">,
    updates: Pick<ArchetypeInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterUpdatePermission(
      { projects: archetype?.projects ? archetype.projects : [] },
      "projects" in updates ? { projects: updates.projects } : {},
      "manageArchetype",
    );
  };

  public canDeleteArchetype = (
    archetype: Pick<ArchetypeInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(
      { projects: archetype?.projects ? archetype.projects : [] },
      "manageArchetype",
    );
  };

  // Helper methods for the front-end
  // Frontend helper to gate "Create Fact Table" UI.
  // Pass allProjects on list pages where "All Projects" may be selected;
  // omit it when checking a specific resource's project or global-only access.
  public canViewCreateFactTableModal = (
    project?: string,
    allProjects?: { id: string }[],
  ): boolean => {
    if (!project && allProjects?.length) {
      // Allow if the user can create a fact table with no project (e.g. a
      // global admin). Checking that first means a non-creatable project (like
      // the read-only sample-data project) can't gate the CTA when it's the
      // only project.
      return (
        this.canCreateFactTable({ projects: [] }) ||
        allProjects.some((p) => this.canCreateFactTable({ projects: [p.id] }))
      );
    }
    return this.canCreateFactTable({ projects: project ? [project] : [] });
  };

  public canCreateFactTable = (
    factTable: Pick<FactTableInterface, "projects" | "managedBy">,
  ): boolean => {
    if (factTable.managedBy && ["admin", "api"].includes(factTable.managedBy)) {
      if (!this.canCreateOfficialResources(factTable)) {
        return false;
      }
    }
    return this.checkProjectFilterPermission(factTable, "manageFactTables");
  };

  public canUpdateFactTable = (
    existing: Pick<FactTableInterface, "projects" | "managedBy"> &
      Partial<Pick<FactTableInterface, "id" | "datasource">>,
    updates: UpdateFactTableProps,
  ): boolean => {
    // We allow changing columns even for managed fact tables
    const changedKeys = Object.keys(updates);
    // The Event Forwarder exception never covers changing managedBy itself —
    // promoting the table to an official resource still needs the permission.
    const changesManagedBy =
      updates.managedBy !== undefined &&
      updates.managedBy !== existing.managedBy;
    const requireManagedByCheck =
      changedKeys.some((k) => k !== "columns") &&
      (changesManagedBy || !isEventForwarderManagedFactTable(existing));

    if (requireManagedByCheck && (existing.managedBy || updates.managedBy)) {
      if (!this.canUpdateOfficialResources(existing, updates)) {
        return false;
      }
    }

    return this.checkProjectFilterUpdatePermission(
      existing,
      updates,
      "manageFactTables",
    );
  };

  // Virtual columns carry a raw SQL expression that is inlined into generated
  // queries, so creating, editing, testing, or deleting one is equivalent in
  // power to editing the fact table's own SQL.
  //
  // `canUpdateFactTable` deliberately skips the managedBy check for
  // `columns`-only updates, because column metadata is refreshed automatically
  // even on managed fact tables. That carve-out predates virtual columns, when
  // `columns` held metadata only. Routing virtual column writes through
  // `canUpdateFactTable(ft, { columns: [] })` would therefore let a user
  // without official-resource access inject SQL into a managed fact table, so
  // apply both gates explicitly here.
  public canManageFactTableVirtualColumn = (
    factTable: Pick<FactTableInterface, "projects" | "managedBy">,
  ): boolean => {
    if (factTable.managedBy) {
      if (!this.canUpdateOfficialResources(factTable, factTable)) {
        return false;
      }
    }
    return this.checkProjectFilterPermission(factTable, "manageFactTables");
  };

  public canDeleteFactTable = (
    factTable: Pick<FactTableInterface, "projects" | "managedBy"> &
      Partial<Pick<FactTableInterface, "id" | "datasource">>,
  ): boolean => {
    if (
      factTable.managedBy &&
      ["admin", "api"].includes(factTable.managedBy) &&
      !isEventForwarderManagedFactTable(factTable)
    ) {
      if (!this.canDeleteOfficialResources(factTable)) {
        return false;
      }
    }

    return this.checkProjectFilterPermission(factTable, "manageFactTables");
  };

  public canCreateAndUpdateFactFilter = (
    factTable: Pick<FactTableInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(factTable, "manageFactFilters");
  };

  public canDeleteFactFilter = (
    factTable: Pick<FactTableInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(factTable, "manageFactFilters");
  };

  public canCreateFactMetric = (
    metric: Pick<FactMetricInterface, "projects" | "managedBy">,
  ): boolean => {
    if (metric.managedBy && ["admin", "api"].includes(metric.managedBy)) {
      if (!this.canCreateOfficialResources(metric)) {
        return false;
      }
    }
    return this.checkProjectFilterPermission(metric, "manageFactMetrics");
  };

  public canUpdateFactMetric = (
    existing: Pick<FactMetricInterface, "projects" | "managedBy">,
    updates: UpdateProps<FactMetricInterface>,
  ): boolean => {
    if (
      (existing.managedBy && ["admin", "api"].includes(existing.managedBy)) ||
      (updates.managedBy && ["admin", "api"].includes(updates.managedBy))
    ) {
      if (!this.canUpdateOfficialResources(existing, updates)) {
        return false;
      }
    }

    return this.checkProjectFilterUpdatePermission(
      existing,
      updates,
      "manageFactMetrics",
    );
  };

  public canDeleteFactMetric = (
    metric: Pick<FactMetricInterface, "projects" | "managedBy">,
  ): boolean => {
    if (metric.managedBy && ["admin", "api"].includes(metric.managedBy)) {
      if (!this.canCreateOfficialResources(metric)) {
        return false;
      }
    }

    return this.checkProjectFilterPermission(metric, "manageFactMetrics");
  };

  public canCreateMetric = (
    metric: Pick<MetricInterface, "projects" | "managedBy">,
  ): boolean => {
    if (metric.managedBy && ["admin", "api"].includes(metric.managedBy)) {
      if (!this.canCreateOfficialResources(metric)) {
        return false;
      }
    }

    return this.checkProjectFilterPermission(metric, "createMetrics");
  };

  public canUpdateMetric = (
    existing: Pick<MetricInterface, "projects" | "managedBy">,
    updates: Pick<MetricInterface, "projects" | "managedBy">,
  ): boolean => {
    if (
      (existing.managedBy && ["admin", "api"].includes(existing.managedBy)) ||
      (updates.managedBy && ["admin", "api"].includes(updates.managedBy))
    ) {
      if (!this.canUpdateOfficialResources(existing, updates)) {
        return false;
      }
    }

    return this.checkProjectFilterUpdatePermission(
      existing,
      updates,
      "createMetrics",
    );
  };

  public canDeleteMetric = (
    metric: Pick<MetricInterface, "projects" | "managedBy">,
  ): boolean => {
    if (metric.managedBy && ["admin", "api"].includes(metric.managedBy)) {
      if (!this.canDeleteOfficialResources(metric)) {
        return false;
      }
    }

    return this.checkProjectFilterPermission(metric, "createMetrics");
  };

  public canEditFeatureDrafts = (
    feature: Pick<FeatureInterface, "project">,
  ) => {
    return this.canRevisionAction("feature", "draft", {
      projects: feature.project ? [feature.project] : [],
    });
  };

  // Required: there is no safe default for "what does this draft change".
  // Pass `{ scope: "any" }` when not sanctioning a change.
  public canReviewFeatureDrafts = (
    feature: Pick<FeatureInterface, "project">,
    footprint: ReviewAuthorityFootprint,
  ): boolean => {
    // Reviewer eligibility follows the primary project only. Targeting projects
    // affect whether a review is required, never who may approve.
    return this.canReviewRevision(
      "feature",
      feature.project ? [feature.project] : [],
      footprint,
    );
  };

  // Saved-group review is project-scoped, so it takes no env requirement.
  public canReviewRevision = (
    model: RevisionModel,
    projects: string[],
    footprint: ReviewAuthorityFootprint,
  ): boolean => {
    return this.canRevisionAction(
      model,
      "review",
      { projects },
      footprintEnvironments(footprint),
    );
  };

  /**
   * Bypass the review requirement on a Feature Flag, Config, or Constant.
   * Atoms are per entity, so a Config unlock must consult the Config atom, not
   * the Feature one. Saved Groups: see canBypassSavedGroupApprovalChecks.
   */
  public canBypassFlagApprovalChecks = (
    obj: {
      project?: string;
      projects?: string[];
    },
    // No default: defaulting to "feature" would let Config/Constant call sites
    // silently consult the wrong entity's bypass atom.
    model: Extract<RevisionModel, "feature" | "config" | "constant">,
  ): boolean => {
    return this.canRevisionAction(model, "bypass", obj);
  };

  public canBypassSavedGroupApprovalChecks = (obj: {
    project?: string;
    projects?: string[];
  }): boolean => {
    return this.canRevisionAction("saved-group", "bypass", obj);
  };

  public canManageCustomFields = (): boolean => {
    return this.checkProjectFilterPermission(
      { projects: [] },
      "manageCustomFields",
    );
  };

  public canManageExecReports = (
    report: Pick<ExecReportInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(
      { projects: report.projects || [] },
      "manageExecReports",
    );
  };

  public canAddComment = (projects: string[]): boolean => {
    return this.checkProjectFilterPermission({ projects }, "addComments");
  };

  public canCreateProjects = (): boolean => {
    return this.checkProjectFilterPermission(
      { projects: [] },
      "createProjects",
    );
  };

  // Used to determine if we should show the Settings > Projects link in SideNav
  public canManageSomeProjects = (): boolean => {
    const projects: string[] = [""];

    Object.keys(this.userPermissions.projects).forEach((key) =>
      projects.push(key),
    );

    return projects.some((project) =>
      this.checkProjectFilterPermission(
        { projects: [project] },
        "manageProjects",
      ),
    );
  };

  // Used to determine if we should show the Settings > Projects link in SideNav
  // Returns true if user can view any projects (even without manage permission)
  public canViewProjectsPage = (): boolean => {
    // If user can manage some projects, they should see the page
    if (this.canManageSomeProjects()) {
      return true;
    }

    // Otherwise, check if they have readData permission globally or in any project
    const projectsToCheck = ["", ...Object.keys(this.userPermissions.projects)];
    return projectsToCheck.some((p) => this.hasPermission("readData", p));
  };

  public canUpdateProject = (project: string): boolean => {
    return this.checkProjectFilterPermission(
      { projects: [project] },
      "manageProjects",
    );
  };

  public canDeleteProject = (project: string): boolean => {
    return this.checkProjectFilterPermission(
      { projects: [project] },
      "deleteProjects",
    );
  };

  // Frontend helper to gate "Create Data Source" UI.
  // Pass allProjects on list pages where "All Projects" may be selected;
  // omit it when checking a specific resource's project or global-only access.
  public canViewCreateDataSourceModal = (
    project?: string,
    allProjects?: { id: string }[],
  ): boolean => {
    if (!project && allProjects?.length) {
      // Allow if the user can create a data source with no project (e.g. a
      // global admin). Checking that first means a non-creatable project (like
      // the read-only sample-data project) can't gate the CTA when it's the
      // only project.
      return (
        this.canCreateDataSource({ projects: [], type: undefined }) ||
        allProjects.some((p) =>
          this.canCreateDataSource({ projects: [p.id], type: undefined }),
        )
      );
    }
    return this.canCreateDataSource({
      projects: project ? [project] : [],
      type: undefined,
    });
  };

  public canCreateDataSource = (datasource: {
    projects?: DataSourceInterface["projects"];
    type: DataSourceInterface["type"] | undefined;
  }): boolean => {
    return this.checkProjectFilterPermission(datasource, "createDatasources");
  };

  public canUpdateDataSourceParams = (datasource: {
    projects?: DataSourceInterface["projects"];
    type: DataSourceInterface["type"] | undefined;
  }): boolean => {
    if (datasource?.type === "growthbook_clickhouse") return false;

    return this.checkProjectFilterPermission(datasource, "createDatasources");
  };

  public canUpdateDataSourceSettings = (
    datasource: Pick<DataSourceInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(
      datasource,
      "editDatasourceSettings",
    );
  };

  public canDeleteDataSource = (
    datasource: Pick<DataSourceInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(datasource, "createDatasources");
  };

  public canRunExperimentQueries = (
    datasource: Pick<DataSourceInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(datasource, "runQueries");
  };

  public canRunPastExperimentQueries = (
    datasource: Pick<DataSourceInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(datasource, "runQueries");
  };

  public canRunFactQueries = (
    datasource: Pick<DataSourceInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(datasource, "runQueries");
  };

  public canRunTestQueries = (
    datasource: Pick<DataSourceInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(datasource, "runQueries");
  };

  public canRunSchemaQueries = (
    datasource: Pick<DataSourceInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(datasource, "runQueries");
  };

  public canRunHealthQueries = (
    datasource: Pick<DataSourceInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(datasource, "runQueries");
  };

  public canCreateExperimentSnapshot = (
    datasource: Pick<DataSourceInterface, "projects">,
  ): boolean => {
    return this.canRunExperimentQueries(datasource);
  };

  public canRunMetricQueries = (
    datasource: Pick<DataSourceInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(datasource, "runQueries");
  };

  public canCreateMetricAnalysis = (
    datasource: Pick<DataSourceInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(datasource, "runQueries");
  };

  public canRunMetricAnalysisQueries = (
    datasource: Pick<DataSourceInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(datasource, "runQueries");
  };

  public canRunPopulationDataQueries = (
    datasource: Pick<DataSourceInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(datasource, "runQueries");
  };

  public canRunPipelineValidationQueries = (
    datasource: Pick<DataSourceInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(datasource, "runQueries");
  };

  // Diagnostics read the flag and write nothing, so any flag authority — or
  // runQueries on the datasource it reads — qualifies. NO_ENVIRONMENT_BINDING:
  // no write, so no footprint to narrow an env-limited publisher against.
  public canRunFeatureDiagnosticsQueries = (
    feature: Pick<FeatureInterface, "project">,
    datasource?: Pick<DataSourceInterface, "projects">,
  ): boolean => {
    return (
      this.canEditFeatureDrafts(feature) ||
      this.canPublishFeature(feature, NO_ENVIRONMENT_BINDING) ||
      this.canReviewFeatureDrafts(feature, { scope: "any" }) ||
      (!!datasource &&
        this.checkProjectFilterPermission(datasource, "runQueries"))
    );
  };

  public canViewSqlExplorerQueries = (
    datasource: Pick<DataSourceInterface, "projects">,
  ): boolean => {
    return this.canReadMultiProjectResource(datasource.projects);
  };

  public canCreateSqlExplorerQueries = (
    datasource: Pick<DataSourceInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(
      datasource,
      "runSqlExplorerQueries",
    );
  };

  public canUpdateSqlExplorerQueries = (
    existing: Pick<DataSourceInterface, "projects">,
    updates: Pick<DataSourceInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterUpdatePermission(
      existing,
      updates,
      "runSqlExplorerQueries",
    );
  };

  public canDeleteSqlExplorerQueries = (
    datasource: Pick<DataSourceInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(
      datasource,
      "runSqlExplorerQueries",
    );
  };

  public canRunSqlExplorerQueries = (
    datasource: Pick<DataSourceInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(
      datasource,
      "runSqlExplorerQueries",
    );
  };

  public canRunProductAnalyticsExplorationQueries = (
    datasource: Pick<DataSourceInterface, "projects">,
    datasetType: ExplorationDataset["type"],
  ): boolean => {
    if (
      datasetType === "metric" ||
      datasetType === "fact_table" ||
      datasetType === "funnel"
    ) {
      return this.canRunMetricAnalysisQueries(datasource);
    }
    return this.canRunSqlExplorerQueries(datasource);
  };

  public canCreateGeneralDashboards = (
    dashboard: Pick<DashboardInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(
      dashboard,
      "manageGeneralDashboards",
    );
  };

  public canUpdateGeneralDashboards = (
    existing: Pick<DashboardInterface, "projects">,
    updates: Pick<DashboardInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterUpdatePermission(
      existing,
      updates,
      "manageGeneralDashboards",
    );
  };

  public canDeleteGeneralDashboards = (
    dashboard: Pick<DashboardInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(
      dashboard,
      "manageGeneralDashboards",
    );
  };

  // ENV_SCOPED_PERMISSIONS
  public canPublishFeature = (
    feature: Pick<FeatureInterface, "project">,
    environments: string[],
  ): boolean => {
    return this.canRevisionAction(
      "feature",
      "publish",
      { projects: feature.project ? [feature.project] : [] },
      environments,
    );
  };

  public canRunExperiment = (
    experiment: Pick<ExperimentInterface, "project">,
    environments: string[],
  ): boolean => {
    return this.checkEnvFilterPermission(
      {
        projects: experiment.project ? [experiment.project] : [],
      },
      environments,
      "runExperiments",
    );
  };

  public canRunHoldout = (
    holdout: Pick<HoldoutInterface, "projects">,
    environments: string[],
  ): boolean => {
    return this.checkEnvFilterPermission(
      {
        projects: holdout.projects || [],
      },
      environments,
      "runExperiments",
    );
  };

  public canCreateEnvironment = (
    environment: Pick<Environment, "projects" | "id">,
  ): boolean => {
    return this.checkEnvFilterPermission(
      {
        projects: environment.projects || [],
      },
      [environment.id],
      "manageEnvironments",
    );
  };

  public canUpdateEnvironment = (
    existing: Pick<Environment, "projects" | "id">,
    updates: Pick<Environment, "projects">,
  ): boolean => {
    const updateObj: { projects?: string[]; environment?: string } = {};

    if ("projects" in updates) {
      updateObj.projects = updates.projects;
    }

    return this.checkEnvFilterUpdatePermission(
      { projects: existing.projects || [], environment: existing.id },
      updateObj,
      "manageEnvironments",
    );
  };

  public canDeleteEnvironment = (
    environment: Pick<Environment, "projects" | "id">,
  ): boolean => {
    return this.checkEnvFilterPermission(
      {
        projects: environment.projects || [],
      },
      [environment.id],
      "manageEnvironments",
    );
  };

  // This is a helper method to use on the frontend to determine whether or not to show certain UI elements
  // Frontend helper to gate "Create Saved Group" UI.
  // Pass allProjects on list pages where "All Projects" may be selected;
  // omit it when checking a specific resource's project or global-only access.
  public canViewSavedGroupModal = (
    project?: string,
    allProjects?: { id: string }[],
  ): boolean => {
    if (!project && allProjects?.length) {
      // Allow if the user can create a saved group with no project (e.g. a
      // global admin). Checking that first means a non-creatable project (like
      // the read-only sample-data project) can't gate the CTA when it's the
      // only project.
      return (
        this.canCreateSavedGroup({ projects: [] }) ||
        allProjects.some((p) => this.canCreateSavedGroup({ projects: [p.id] }))
      );
    }
    return this.canCreateSavedGroup({ projects: project ? [project] : [] });
  };

  public canCreateSavedGroup = (
    savedGroup: Pick<SavedGroupInterface, "projects">,
  ): boolean => {
    return this.canRevisionAction(
      "saved-group",
      "create",
      savedGroup,
      NO_ENVIRONMENT_BINDING,
    );
  };

  public canDeleteSavedGroup = (
    savedGroup: Pick<SavedGroupInterface, "projects">,
  ): boolean => {
    return this.canRevisionAction("saved-group", "delete", savedGroup);
  };

  public canCreateLearning = (learning: { projects?: string[] }): boolean => {
    return this.checkProjectFilterPermission(
      { projects: learning.projects || [] },
      "manageLearnings",
    );
  };

  public canUpdateLearning = (
    existing: { projects?: string[] },
    updates: { projects?: string[] },
  ): boolean => {
    return this.checkProjectFilterUpdatePermission(
      { projects: existing.projects || [] },
      { projects: updates.projects || [] },
      "manageLearnings",
    );
  };

  public canDeleteLearning = (learning: { projects?: string[] }): boolean => {
    return this.checkProjectFilterPermission(
      { projects: learning.projects || [] },
      "manageLearnings",
    );
  };

  /**
   * Project-scoped only. A create body CAN declare `environmentValues`; that
   * env-scoped half is a publish and is gated at the create surfaces by
   * `assertCanCreateConstantInState`, not here.
   */
  public canCreateConstant = (
    constant: Pick<ConstantInterface, "project">,
  ): boolean => {
    return this.canRevisionAction(
      "constant",
      "create",
      { projects: constant.project ? [constant.project] : [] },
      NO_ENVIRONMENT_BINDING,
    );
  };

  public canDeleteConstant = (
    constant: Pick<ConstantInterface, "project">,
    environments: string[],
  ): boolean => {
    return this.canRevisionAction(
      "constant",
      "delete",
      { projects: constant.project ? [constant.project] : [] },
      environments,
    );
  };

  /**
   * Project-scoped only. A create body CAN attach `scopedOverrides` (env-scoped
   * flavors that serve immediately — a feature may already embed a `@config:`
   * ref to the new key); that half is a publish and is gated at the create
   * surfaces by `assertCanCreateConfigInState`, not here.
   */
  public canCreateConfig = (
    config: Pick<ConfigInterface, "project">,
  ): boolean => {
    return this.canRevisionAction(
      "config",
      "create",
      { projects: config.project ? [config.project] : [] },
      NO_ENVIRONMENT_BINDING,
    );
  };

  public canDeleteConfig = (
    config: Pick<ConfigInterface, "project">,
    environments: string[],
  ): boolean => {
    return this.canRevisionAction(
      "config",
      "delete",
      { projects: config.project ? [config.project] : [] },
      environments,
    );
  };

  public canBypassSavedGroupSizeLimit = (projects?: string[]): boolean => {
    return this.checkProjectFilterPermission(
      { projects },
      "bypassSavedGroupSizeLimit",
    );
  };

  // UI helper - when determining if we can show the `Create SDK Connection` button, this ignores any env level restrictions
  // and just takes in the current project
  public canViewCreateSDKConnectionModal = (project?: string): boolean => {
    return this.hasPermission("manageEnvironments", project || "");
  };

  public canCreateSDKConnection = (
    sdkConnection: Pick<SDKConnectionInterface, "projects" | "environment">,
  ): boolean => {
    return this.checkEnvFilterPermission(
      sdkConnection,
      [sdkConnection.environment],
      "manageSDKConnections",
    );
  };

  public canUpdateSDKConnection = (
    existing: { projects?: string[]; environment?: string },
    updates: { projects?: string[]; environment?: string },
  ): boolean => {
    return this.checkEnvFilterUpdatePermission(
      existing,
      updates,
      "manageSDKConnections",
    );
  };

  public canDeleteSDKConnection = (
    sdkConnection: Pick<SDKConnectionInterface, "projects" | "environment">,
  ): boolean => {
    return this.checkEnvFilterPermission(
      sdkConnection,
      [sdkConnection.environment],
      "manageSDKConnections",
    );
  };

  public canManageLegacySDKWebhooks = (): boolean => {
    // These webhooks are deprecated
    // Restrict access to admins by using the event webhooks permission
    return this.checkGlobalPermission("manageEventWebhooks");
  };

  public canCreateSDKWebhook = (
    sdkConnection: Pick<SDKConnectionInterface, "projects" | "environment">,
  ): boolean => {
    return this.checkEnvFilterPermission(
      sdkConnection,
      [sdkConnection.environment],
      "manageSDKWebhooks",
    );
  };

  public canUpdateSDKWebhook = (
    sdkConnection: Pick<SDKConnectionInterface, "projects" | "environment">,
  ): boolean => {
    return this.checkEnvFilterPermission(
      sdkConnection,
      [sdkConnection.environment],
      "manageSDKWebhooks",
    );
  };

  public canDeleteSDKWebhook = (
    sdkConnection: Pick<SDKConnectionInterface, "projects" | "environment">,
  ): boolean => {
    return this.checkEnvFilterPermission(
      sdkConnection,
      [sdkConnection.environment],
      "manageSDKWebhooks",
    );
  };

  public canCreateCustomHook = (
    customHook: Pick<CustomHookInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(customHook, "manageCustomHooks");
  };

  public canUpdateCustomHook = (
    existing: Pick<CustomHookInterface, "projects">,
    updates: Pick<CustomHookInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterUpdatePermission(
      existing,
      updates,
      "manageCustomHooks",
    );
  };

  public canDeleteCustomHook = (
    customHook: Pick<CustomHookInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(customHook, "manageCustomHooks");
  };

  // A hook constrains which future writes are allowed and serves no value to any
  // user, so it is not publish-class — and draft-class keeps whoever writes the
  // rules distinct from whoever lands changes. Org/config hooks take
  // `manageCustomHooks`.
  public canManageFeatureCustomHooks = (
    feature: Pick<FeatureInterface, "project">,
  ): boolean => {
    return this.canEditFeatureDrafts(feature);
  };

  public canManageExperimentCustomHooks = (
    experiment: Pick<ExperimentInterface, "project">,
  ): boolean => {
    return this.canUpdateExperiment(experiment, {});
  };

  public canCreateEventForwarderConfig = (
    config: Pick<EventForwarderConfigInterface, "projects">,
  ): boolean => {
    return (
      this.checkProjectFilterPermission(config, "editDatasourceSettings") &&
      this.checkProjectFilterPermission(config, "runQueries")
    );
  };

  public canUpdateEventForwarderConfig = (
    existing: Pick<EventForwarderConfigInterface, "projects">,
    updates: Pick<EventForwarderConfigInterface, "projects">,
  ): boolean => {
    return (
      this.checkProjectFilterUpdatePermission(
        existing,
        updates,
        "editDatasourceSettings",
      ) &&
      this.checkProjectFilterUpdatePermission(existing, updates, "runQueries")
    );
  };

  public canDeleteEventForwarderConfig = (
    config: Pick<EventForwarderConfigInterface, "projects">,
  ): boolean => {
    return (
      this.checkProjectFilterPermission(config, "editDatasourceSettings") &&
      this.checkProjectFilterPermission(config, "runQueries")
    );
  };

  public throwPermissionError(message?: string): void {
    throw new PermissionError(
      message ?? "You do not have permission to perform this action",
    );
  }

  public canReadSingleProjectResource = (
    project: string | undefined,
  ): boolean => {
    return this.hasPermission("readData", project || "");
  };

  // Project IDs where the user has the given permission
  // Return value:
  //   string[] = specific projects
  //   [] = no projects
  //   null = global (all projects)
  public getProjectsWithPermission = (
    permission: Permission,
  ): string[] | null => {
    if (this.hasPermission(permission, "")) return null;
    return Object.keys(this.userPermissions.projects).filter((p) =>
      this.hasPermission(permission, p),
    );
  };

  public canReadMultiProjectResource = (
    projects: string[] | undefined,
  ): boolean => {
    // If the resource doesn't have a projects property or it's an empty array
    // that means it's in all projects
    if (!projects || !projects.length) {
      const projectsToCheck = [
        "",
        ...Object.keys(this.userPermissions.projects),
      ];
      // Must have read access globally or in at least 1 project
      return projectsToCheck.some((p) => this.hasPermission("readData", p));
    }

    // Otherwise, check if they have read access for atleast 1 of the resource's projects
    return projects.some((p) => this.hasPermission("readData", p));
  };

  // Targeting-scoped READ: readable via the governance project OR any targeting
  // project (or all). Widens read/discovery only; governance/write keys on `project`.
  public canReadTargetingScopedResource = (
    entity: TargetingScopedEntity,
  ): boolean => {
    // null (all projects) maps to the empty-array "all" convention.
    return this.canReadMultiProjectResource(
      getTargetingProjectIds(entity) ?? [],
    );
  };

  public canManageCustomRoles = (): boolean => {
    return this.checkGlobalPermission("manageCustomRoles");
  };

  private checkGlobalPermission(permissionToCheck: GlobalPermission): boolean {
    return this.userPermissions.global.permissions[permissionToCheck] || false;
  }

  private checkProjectFilterPermission(
    obj: { projects?: string[] },
    permission: ProjectScopedPermission,
  ): boolean {
    const projects = obj.projects?.length ? obj.projects : [""];

    if (READ_ONLY_PERMISSIONS.includes(permission)) {
      if (
        projects.length === 1 &&
        !projects[0] &&
        Object.keys(this.userPermissions.projects).length
      ) {
        projects.push(...Object.keys(this.userPermissions.projects));
      }
      return projects.some((project) =>
        this.hasPermission(permission, project),
      );
    }
    return projects.every((project) => this.hasPermission(permission, project));
  }

  private checkProjectFilterUpdatePermission(
    existing: { projects?: string[] },
    updates: { projects?: string[] } | undefined,
    permission: ProjectScopedPermission,
  ): boolean {
    // check if the user has permission to update based on the existing projects
    if (!this.checkProjectFilterPermission(existing, permission)) {
      return false;
    }

    // if the updates include projects, check if the user has permission to update based on the new projects
    if (
      updates &&
      "projects" in updates &&
      !this.checkProjectFilterPermission(updates, permission)
    ) {
      return false;
    }
    return true;
  }

  private checkUnrestrictedEnvAuthority(
    obj: { projects?: string[] },
    permission: Permission,
  ): boolean {
    const projects = obj.projects?.length ? obj.projects : [""];

    return projects.every((project) => {
      const scoped =
        this.userPermissions.projects[project] || this.userPermissions.global;
      if (!scoped?.permissions[permission]) return false;
      return hasUnrestrictedEnvAuthority(scoped, permission);
    });
  }

  public checkEnvFilterPermission(
    obj: { projects?: string[] },
    envs: string[],
    permission: EnvScopedPermission,
  ): boolean {
    const projects = obj.projects?.length ? obj.projects : [""];

    return projects.every((project) =>
      this.hasPermission(permission, project, envs),
    );
  }

  private checkEnvFilterUpdatePermission(
    existing: { projects?: string[]; environment?: string },
    updates: { projects?: string[]; environment?: string },
    permission: EnvScopedPermission,
  ): boolean {
    if (
      !this.checkEnvFilterPermission(
        existing,
        existing.environment ? [existing.environment] : [],
        permission,
      )
    ) {
      return false;
    }

    const updatedObj = { ...existing, ...updates };

    return this.checkEnvFilterPermission(
      updatedObj,
      updatedObj.environment ? [updatedObj.environment] : [],
      permission,
    );
  }

  private hasPermission(
    permissionToCheck: Permission,
    project: string,
    envs?: string[],
  ) {
    const usersPermissionsToCheck =
      this.userPermissions.projects[project] || this.userPermissions.global;

    if (!usersPermissionsToCheck.permissions[permissionToCheck]) {
      return false;
    }

    // One implementation, shared with the standalone `hasPermission` used by
    // middleware and API keys — see `envsAllowedBy`.
    return envsAllowedBy(usersPermissionsToCheck, permissionToCheck, envs);
  }
}
