import { FeatureInterface } from "back-end/types/feature";
import { MetricInterface } from "back-end/types/metric";
import {
  EnvScopedPermission,
  Environment,
  GlobalPermission,
  Permission,
  ProjectScopedPermission,
  SDKAttribute,
  UserPermissions,
} from "back-end/types/organization";
import { IdeaInterface } from "back-end/types/idea";
import {
  FactMetricInterface,
  FactTableInterface,
  UpdateFactTableProps,
} from "back-end/types/fact-table";
import { ExecReportInterface } from "back-end/src/models/ExecReportModel";
import {
  ExperimentInterface,
  ExperimentTemplateInterface,
  UpdateTemplateProps,
} from "back-end/types/experiment";
import { DataSourceInterface } from "back-end/types/datasource";
import { UpdateProps } from "back-end/types/models";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import { ArchetypeInterface } from "back-end/types/archetype";
import { SegmentInterface } from "back-end/types/segment";
import { HoldoutInterface } from "back-end/src/routers/holdout/holdout.validators";
import { CustomHookInterface } from "back-end/src/routers/custom-hooks/custom-hooks.validators";
import { DashboardInterface } from "back-end/src/enterprise/validators/dashboard";
import { SavedGroupInterface } from "../types";
import { READ_ONLY_PERMISSIONS } from "./permissions.constants";
class PermissionError extends Error {
  status = 403;
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}

type NotificationEvent = {
  containsSecrets: boolean;
  projects: string[];
};

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

  // This is a helper method to use on the frontend to determine whether or not to show certain UI elements
  public canViewAttributeModal = (project?: string): boolean => {
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

  // This is a helper method to use on the frontend to determine whether or not to show certain UI elements
  public canViewFeatureModal = (project?: string): boolean => {
    return this.checkProjectFilterPermission(
      {
        projects: project ? [project] : [],
      },
      "manageFeatures",
    );
  };

  public canCreateFeature = (
    feature: Pick<FeatureInterface, "project">,
  ): boolean => {
    return this.checkProjectFilterPermission(
      {
        projects: feature.project ? [feature.project] : [],
      },
      "manageFeatures",
    );
  };

  public canUpdateFeature = (
    existing: Pick<FeatureInterface, "project">,
    updated: Pick<FeatureInterface, "project">,
  ): boolean => {
    return this.checkProjectFilterUpdatePermission(
      { projects: existing.project ? [existing.project] : [] },
      "project" in updated ? { projects: [updated.project || ""] } : {},
      "manageFeatures",
    );
  };

  public canDeleteFeature = (
    feature: Pick<FeatureInterface, "project">,
  ): boolean => {
    return this.checkProjectFilterPermission(
      {
        projects: feature.project ? [feature.project] : [],
      },
      "manageFeatures",
    );
  };

  // This is a helper method to use on the frontend to determine whether or not to show certain UI elements
  public canViewExperimentModal = (project?: string): boolean => {
    return this.checkProjectFilterPermission(
      {
        projects: project ? [project] : [],
      },
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

  // This is a helper method to use on the frontend to determine whether or not to show certain UI elements
  public canViewHoldoutModal = (projects?: string[]): boolean => {
    return this.checkProjectFilterPermission(
      {
        projects: projects || [],
      },
      "createAnalyses",
    );
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

  // This is a helper method to use on the frontend to determine whether or not to show certain UI elements
  public canViewExperimentTemplateModal = (project?: string): boolean => {
    return this.checkProjectFilterPermission(
      {
        projects: project ? [project] : [],
      },
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
  public canViewIdeaModal = (project?: string): boolean => {
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
  public canViewCreateFactTableModal = (project?: string): boolean => {
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
    existing: Pick<FactTableInterface, "projects" | "managedBy">,
    updates: UpdateFactTableProps,
  ): boolean => {
    // We allow changing columns even for managed fact tables
    const changedKeys = Object.keys(updates);
    const requireManagedByCheck = changedKeys.some((k) => k !== "columns");

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

  public canDeleteFactTable = (
    factTable: Pick<FactTableInterface, "projects" | "managedBy">,
  ): boolean => {
    if (factTable.managedBy && ["admin", "api"].includes(factTable.managedBy)) {
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

  public canManageFeatureDrafts = (
    feature: Pick<FeatureInterface, "project">,
  ) => {
    return this.checkProjectFilterPermission(
      { projects: feature.project ? [feature.project] : [] },
      "manageFeatureDrafts",
    );
  };

  public canReviewFeatureDrafts = (
    feature: Pick<FeatureInterface, "project">,
  ): boolean => {
    return this.checkProjectFilterPermission(
      { projects: feature.project ? [feature.project] : [] },
      "canReview",
    );
  };

  public canBypassApprovalChecks = (
    feature: Pick<FeatureInterface, "project">,
  ): boolean => {
    return this.checkProjectFilterPermission(
      { projects: feature.project ? [feature.project] : [] },
      "bypassApprovalChecks",
    );
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
      "manageProjects",
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

  public canUpdateProject = (project: string): boolean => {
    return this.checkProjectFilterPermission(
      { projects: [project] },
      "manageProjects",
    );
  };

  public canDeleteProject = (project: string): boolean => {
    return this.checkProjectFilterPermission(
      { projects: [project] },
      "manageProjects",
    );
  };

  public canViewCreateDataSourceModal = (project?: string): boolean => {
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
    return this.checkEnvFilterPermission(
      {
        projects: feature.project ? [feature.project] : [],
      },
      environments,
      "publishFeatures",
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
  public canViewSavedGroupModal = (project?: string): boolean => {
    return this.canCreateSavedGroup({ projects: project ? [project] : [] });
  };

  public canCreateSavedGroup = (
    savedGroup: Pick<SavedGroupInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(savedGroup, "manageSavedGroups");
  };

  public canUpdateSavedGroup = (
    existing: Pick<SavedGroupInterface, "projects">,
    updates: Pick<SavedGroupInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterUpdatePermission(
      existing,
      updates,
      "manageSavedGroups",
    );
  };

  public canDeleteSavedGroup = (
    savedGroup: Pick<SavedGroupInterface, "projects">,
  ): boolean => {
    return this.checkProjectFilterPermission(savedGroup, "manageSavedGroups");
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

  public throwPermissionError(): void {
    throw new PermissionError(
      "You do not have permission to perform this action",
    );
  }

  public canReadSingleProjectResource = (
    project: string | undefined,
  ): boolean => {
    return this.hasPermission("readData", project || "");
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

    if (!envs || !usersPermissionsToCheck.limitAccessByEnvironment) {
      return true;
    }
    return envs.every((env) =>
      usersPermissionsToCheck.environments.includes(env),
    );
  }
}
