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
import { ExperimentInterface } from "back-end/types/experiment";
import { DataSourceInterface } from "back-end/types/datasource";
import { UpdateProps } from "back-end/types/models";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import { READ_ONLY_PERMISSIONS } from "./permissions.utils";
class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}

export class Permissions {
  private userPermissions: UserPermissions;
  private superAdmin: boolean;
  constructor(permissions: UserPermissions, superAdmin: boolean) {
    this.userPermissions = permissions;
    this.superAdmin = superAdmin;
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
    return this.checkGlobalPermission("manageWebhooks");
  };

  public canCreateEventWebhook = (): boolean => {
    return this.checkGlobalPermission("manageWebhooks");
  };

  public canUpdateEventWebhook = (): boolean => {
    return this.checkGlobalPermission("manageWebhooks");
  };

  public canDeleteEventWebhook = (): boolean => {
    return this.checkGlobalPermission("manageWebhooks");
  };

  public canCreateSDKWebhook = (): boolean => {
    return this.checkGlobalPermission("manageWebhooks");
  };

  public canUpdateSDKWebhook = (): boolean => {
    return this.checkGlobalPermission("manageWebhooks");
  };

  public canDeleteSDKWebhook = (): boolean => {
    return this.checkGlobalPermission("manageWebhooks");
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

  public canCreateSegment = (): boolean => {
    return this.checkGlobalPermission("createSegments");
  };

  public canUpdateSegment = (): boolean => {
    return this.checkGlobalPermission("createSegments");
  };

  public canDeleteSegment = (): boolean => {
    return this.checkGlobalPermission("createSegments");
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

  public canViewEvents = (): boolean => {
    return this.checkGlobalPermission("viewEvents");
  };

  public canCreateArchetype = (): boolean => {
    return this.checkGlobalPermission("manageArchetype");
  };

  public canUpdateArchetype = (): boolean => {
    return this.checkGlobalPermission("manageArchetype");
  };

  public canDeleteArchetype = (): boolean => {
    return this.checkGlobalPermission("manageArchetype");
  };

  public canCreateSavedGroup = (): boolean => {
    return this.checkGlobalPermission("manageSavedGroups");
  };

  public canUpdateSavedGroup = (): boolean => {
    return this.checkGlobalPermission("manageSavedGroups");
  };

  public canDeleteSavedGroup = (): boolean => {
    return this.checkGlobalPermission("manageSavedGroups");
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
  public canCreateVisualChange = (
    experiment: Pick<ExperimentInterface, "project">
  ): boolean => {
    return this.checkProjectFilterPermission(
      { projects: experiment.project ? [experiment.project] : [] },
      "manageVisualChanges"
    );
  };

  public canUpdateVisualChange = (
    experiment: Pick<ExperimentInterface, "project">
  ): boolean => {
    return this.checkProjectFilterPermission(
      { projects: experiment.project ? [experiment.project] : [] },
      "manageVisualChanges"
    );
  };

  // This is a helper method to use on the frontend to determine whether or not to show certain UI elements
  public canViewAttributeModal = (project?: string): boolean => {
    return this.canCreateAttribute({ projects: project ? [project] : [] });
  };

  public canCreateAttribute = (
    attribute: Pick<SDKAttribute, "projects">
  ): boolean => {
    return this.checkProjectFilterPermission(
      attribute,
      "manageTargetingAttributes"
    );
  };

  public canUpdateAttribute = (
    existing: Pick<SDKAttribute, "projects">,
    updates: Pick<SDKAttribute, "projects">
  ): boolean => {
    return this.checkProjectFilterUpdatePermission(
      existing,
      updates,
      "manageTargetingAttributes"
    );
  };

  public canDeleteAttribute = (
    attribute: Pick<SDKAttribute, "projects">
  ): boolean => {
    return this.checkProjectFilterPermission(
      attribute,
      "manageTargetingAttributes"
    );
  };

  // This is a helper method to use on the frontend to determine whether or not to show certain UI elements
  public canViewFeatureModal = (project?: string): boolean => {
    return this.checkProjectFilterPermission(
      {
        projects: project ? [project] : [],
      },
      "manageFeatures"
    );
  };

  public canCreateFeature = (
    feature: Pick<FeatureInterface, "project">
  ): boolean => {
    return this.checkProjectFilterPermission(
      {
        projects: feature.project ? [feature.project] : [],
      },
      "manageFeatures"
    );
  };

  public canUpdateFeature = (
    existing: Pick<FeatureInterface, "project">,
    updated: Pick<FeatureInterface, "project">
  ): boolean => {
    return this.checkProjectFilterUpdatePermission(
      { projects: existing.project ? [existing.project] : [] },
      "project" in updated ? { projects: [updated.project || ""] } : {},
      "manageFeatures"
    );
  };

  public canDeleteFeature = (
    feature: Pick<FeatureInterface, "project">
  ): boolean => {
    return this.checkProjectFilterPermission(
      {
        projects: feature.project ? [feature.project] : [],
      },
      "manageFeatures"
    );
  };

  // This is a helper method to use on the frontend to determine whether or not to show certain UI elements
  public canViewExperimentModal = (project?: string): boolean => {
    return this.checkProjectFilterPermission(
      {
        projects: project ? [project] : [],
      },
      "createAnalyses"
    );
  };

  public canCreateExperiment = (
    experiment: Pick<ExperimentInterface, "project">
  ): boolean => {
    return this.checkProjectFilterPermission(
      {
        projects: experiment.project ? [experiment.project] : [],
      },
      "createAnalyses"
    );
  };

  public canUpdateExperiment = (
    existing: Pick<ExperimentInterface, "project">,
    updated: Pick<ExperimentInterface, "project">
  ): boolean => {
    return this.checkProjectFilterUpdatePermission(
      { projects: existing.project ? [existing.project] : [] },
      "project" in updated ? { projects: [updated.project || ""] } : {},
      "createAnalyses"
    );
  };

  public canDeleteExperiment = (
    experiment: Pick<ExperimentInterface, "project">
  ): boolean => {
    return this.checkProjectFilterPermission(
      { projects: experiment.project ? [experiment.project] : [] },
      "createAnalyses"
    );
  };

  // This is a helper method to use on the frontend to determine whether or not to show certain UI elements
  public canViewReportModal = (project?: string): boolean => {
    return this.checkProjectFilterPermission(
      {
        projects: project ? [project] : [],
      },
      "createAnalyses"
    );
  };
  // reports don't have projects, but their connected experiments do
  public canCreateReport = (
    connectedExperiment: Pick<ExperimentInterface, "project">
  ): boolean => {
    return this.checkProjectFilterPermission(
      {
        projects: connectedExperiment.project
          ? [connectedExperiment.project]
          : [],
      },
      "createAnalyses"
    );
  };

  // reports don't have projects, but their connected experiments do
  public canUpdateReport = (
    connectedExperiment: Pick<ExperimentInterface, "project">
  ): boolean => {
    return this.checkProjectFilterPermission(
      {
        projects: connectedExperiment.project
          ? [connectedExperiment.project]
          : [],
      },
      "createAnalyses"
    );
  };

  // reports don't have projects, but their connected experiments do
  public canDeleteReport = (
    connectedExperiment: Pick<ExperimentInterface, "project">
  ): boolean => {
    return this.checkProjectFilterPermission(
      {
        projects: connectedExperiment.project
          ? [connectedExperiment.project]
          : [],
      },
      "createAnalyses"
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
      "createIdeas"
    );
  };

  public canUpdateIdea = (
    existing: Pick<IdeaInterface, "project">,
    updated: Pick<IdeaInterface, "project">
  ): boolean => {
    return this.checkProjectFilterUpdatePermission(
      { projects: existing.project ? [existing.project] : [] },
      "project" in updated ? { projects: [updated.project || ""] } : {},
      "createIdeas"
    );
  };

  public canDeleteIdea = (idea: Pick<IdeaInterface, "project">): boolean => {
    return this.checkProjectFilterPermission(
      { projects: idea.project ? [idea.project] : [] },
      "createIdeas"
    );
  };

  // Helper methods for the front-end
  public canViewCreateFactTableModal = (project?: string): boolean => {
    return this.canCreateFactTable({ projects: project ? [project] : [] });
  };
  public canViewEditFactTableModal = (
    factTable: Pick<FactTableInterface, "projects">
  ): boolean => {
    return this.canUpdateFactTable(factTable, {});
  };

  public canCreateFactTable = (
    factTable: Pick<FactTableInterface, "projects">
  ): boolean => {
    return this.checkProjectFilterPermission(factTable, "manageFactTables");
  };

  public canUpdateFactTable = (
    existing: Pick<FactTableInterface, "projects">,
    updates: UpdateFactTableProps
  ): boolean => {
    return this.checkProjectFilterUpdatePermission(
      existing,
      updates,
      "manageFactTables"
    );
  };

  public canDeleteFactTable = (
    factTable: Pick<FactTableInterface, "projects">
  ): boolean => {
    return this.checkProjectFilterPermission(factTable, "manageFactTables");
  };

  public canCreateAndUpdateFactFilter = (
    factTable: Pick<FactTableInterface, "projects">
  ): boolean => {
    return this.checkProjectFilterPermission(factTable, "manageFactTables");
  };

  public canDeleteFactFilter = (
    factTable: Pick<FactTableInterface, "projects">
  ): boolean => {
    return this.checkProjectFilterPermission(factTable, "manageFactTables");
  };

  public canCreateFactMetric = (
    metric: Pick<FactMetricInterface, "projects">
  ): boolean => {
    return this.checkProjectFilterPermission(metric, "createMetrics");
  };

  public canUpdateFactMetric = (
    existing: Pick<FactMetricInterface, "projects">,
    updates: UpdateProps<FactMetricInterface>
  ): boolean => {
    return this.checkProjectFilterUpdatePermission(
      existing,
      updates,
      "createMetrics"
    );
  };

  public canDeleteFactMetric = (
    metric: Pick<FactMetricInterface, "projects">
  ): boolean => {
    return this.checkProjectFilterPermission(metric, "createMetrics");
  };

  public canCreateMetric = (
    metric: Pick<MetricInterface, "projects">
  ): boolean => {
    return this.checkProjectFilterPermission(metric, "createMetrics");
  };

  public canUpdateMetric = (
    existing: Pick<MetricInterface, "projects">,
    updates: Pick<MetricInterface, "projects">
  ): boolean => {
    return this.checkProjectFilterUpdatePermission(
      existing,
      updates,
      "createMetrics"
    );
  };

  public canDeleteMetric = (
    metric: Pick<MetricInterface, "projects">
  ): boolean => {
    return this.checkProjectFilterPermission(metric, "createMetrics");
  };

  public canManageFeatureDrafts = (
    feature: Pick<FeatureInterface, "project">
  ) => {
    return this.checkProjectFilterPermission(
      { projects: feature.project ? [feature.project] : [] },
      "manageFeatureDrafts"
    );
  };

  public canReviewFeatureDrafts = (
    feature: Pick<FeatureInterface, "project">
  ): boolean => {
    return this.checkProjectFilterPermission(
      { projects: feature.project ? [feature.project] : [] },
      "canReview"
    );
  };

  public canBypassApprovalChecks = (
    feature: Pick<FeatureInterface, "project">
  ): boolean => {
    return this.checkProjectFilterPermission(
      { projects: feature.project ? [feature.project] : [] },
      "bypassApprovalChecks"
    );
  };

  public canAddComment = (projects: string[]): boolean => {
    return this.checkProjectFilterPermission({ projects }, "addComments");
  };

  public canCreateProjects = (): boolean => {
    return this.checkProjectFilterPermission(
      { projects: [] },
      "manageProjects"
    );
  };

  public canUpdateSomeProjects = (): boolean => {
    // TODO: loop through all projects and check if the user has permission to update at least one
    return this.checkProjectFilterPermission(
      { projects: [] },
      "manageProjects"
    );
  };

  public canUpdateProject = (project: string): boolean => {
    return this.checkProjectFilterPermission(
      { projects: [project] },
      "manageProjects"
    );
  };

  public canDeleteProject = (project: string): boolean => {
    return this.checkProjectFilterPermission(
      { projects: [project] },
      "manageProjects"
    );
  };

  public canViewCreateDataSourceModal = (project?: string): boolean => {
    return this.canCreateDataSource({ projects: project ? [project] : [] });
  };

  public canCreateDataSource = (
    datasource: Pick<DataSourceInterface, "projects">
  ): boolean => {
    return this.checkProjectFilterPermission(datasource, "createDatasources");
  };

  public canUpdateDataSourceParams = (
    datasource: Pick<DataSourceInterface, "projects">
  ): boolean => {
    return this.checkProjectFilterPermission(datasource, "createDatasources");
  };

  public canUpdateDataSourceSettings = (
    datasource: Pick<DataSourceInterface, "projects">
  ): boolean => {
    return this.checkProjectFilterPermission(
      datasource,
      "editDatasourceSettings"
    );
  };

  public canDeleteDataSource = (
    datasource: Pick<DataSourceInterface, "projects">
  ): boolean => {
    return this.checkProjectFilterPermission(datasource, "createDatasources");
  };

  public canRunExperimentQueries = (
    datasource: Pick<DataSourceInterface, "projects">
  ): boolean => {
    return this.checkProjectFilterPermission(datasource, "runQueries");
  };

  public canRunPastExperimentQueries = (
    datasource: Pick<DataSourceInterface, "projects">
  ): boolean => {
    return this.checkProjectFilterPermission(datasource, "runQueries");
  };

  public canRunFactQueries = (
    datasource: Pick<DataSourceInterface, "projects">
  ): boolean => {
    return this.checkProjectFilterPermission(datasource, "runQueries");
  };

  public canRunTestQueries = (
    datasource: Pick<DataSourceInterface, "projects">
  ): boolean => {
    return this.checkProjectFilterPermission(datasource, "runQueries");
  };

  public canRunSchemaQueries = (
    datasource: Pick<DataSourceInterface, "projects">
  ): boolean => {
    return this.checkProjectFilterPermission(datasource, "runQueries");
  };

  public canRunHealthQueries = (
    datasource: Pick<DataSourceInterface, "projects">
  ): boolean => {
    return this.checkProjectFilterPermission(datasource, "runQueries");
  };

  public canRunMetricQueries = (
    datasource: Pick<DataSourceInterface, "projects">
  ): boolean => {
    return this.checkProjectFilterPermission(datasource, "runQueries");
  };

  // ENV_SCOPED_PERMISSIONS
  public canPublishFeature = (
    feature: Pick<FeatureInterface, "project">,
    environments: string[]
  ): boolean => {
    return this.checkEnvFilterPermission(
      {
        projects: feature.project ? [feature.project] : [],
      },
      environments,
      "publishFeatures"
    );
  };

  public canRunExperiment = (
    experiment: Pick<ExperimentInterface, "project">,
    environments: string[]
  ): boolean => {
    return this.checkEnvFilterPermission(
      {
        projects: experiment.project ? [experiment.project] : [],
      },
      environments,
      "runExperiments"
    );
  };

  //TODO: Refactor this into two separate methods and eliminate updating envs from organizations.controller.putOrganization - Github Issue #2494
  public canCreateOrUpdateEnvironment = (
    environment: Pick<Environment, "projects" | "id">
  ): boolean => {
    return this.checkEnvFilterPermission(
      {
        projects: environment.projects || [],
      },
      [environment.id],
      "manageEnvironments"
    );
  };

  public canDeleteEnvironment = (
    environment: Pick<Environment, "projects" | "id">
  ): boolean => {
    return this.checkEnvFilterPermission(
      {
        projects: environment.projects || [],
      },
      [environment.id],
      "manageEnvironments"
    );
  };

  // UI helper - when determining if we can show the `Create SDK Connection` button, this ignores any env level restrictions
  // and just takes in the current project
  public canViewCreateSDKConnectionModal = (project?: string): boolean => {
    return this.hasPermission("manageEnvironments", project || "");
  };

  public canCreateSDKConnection = (
    sdkConnection: Pick<SDKConnectionInterface, "projects" | "environment">
  ): boolean => {
    return this.checkEnvFilterPermission(
      sdkConnection,
      [sdkConnection.environment],
      "manageEnvironments"
    );
  };

  public canUpdateSDKConnection = (
    existing: { projects?: string[]; environment?: string },
    updates: { projects?: string[]; environment?: string }
  ): boolean => {
    return this.checkEnvFilterUpdatePermission(
      existing,
      updates,
      "manageEnvironments"
    );
  };

  public canDeleteSDKConnection = (
    sdkConnection: Pick<SDKConnectionInterface, "projects" | "environment">
  ): boolean => {
    return this.checkEnvFilterPermission(
      sdkConnection,
      [sdkConnection.environment],
      "manageEnvironments"
    );
  };

  public throwPermissionError(): void {
    throw new PermissionError(
      "You do not have permission to perform this action"
    );
  }

  public canReadSingleProjectResource = (
    project: string | undefined
  ): boolean => {
    return this.hasPermission("readData", project || "");
  };

  public canReadMultiProjectResource = (
    projects: string[] | undefined
  ): boolean => {
    if (this.superAdmin) {
      return true;
    }

    // If the resource doesn't have a projects property or it's an empty array
    // that means it's in all projects
    if (!projects || !projects.length) {
      // If the user has read access via their global role, they should be able to read
      if (this.hasPermission("readData", "")) {
        return true;
      }
      // if the user has read access globally, or in atleast 1 project they should have read access
      return this.hasReadAccessForAtleast1Project();
    }

    // Otherwise, check if they have read access for atleast 1 of the resource's projects
    return projects.some((p) => this.hasPermission("readData", p));
  };

  private checkGlobalPermission(permissionToCheck: GlobalPermission): boolean {
    if (this.superAdmin) {
      return true;
    }

    return this.userPermissions.global.permissions[permissionToCheck] || false;
  }

  private checkProjectFilterPermission(
    obj: { projects?: string[] },
    permission: ProjectScopedPermission
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
        this.hasPermission(permission, project)
      );
    }
    return projects.every((project) => this.hasPermission(permission, project));
  }

  private checkProjectFilterUpdatePermission(
    existing: { projects?: string[] },
    updates: { projects?: string[] },
    permission: ProjectScopedPermission
  ): boolean {
    // check if the user has permission to update based on the existing projects
    if (!this.checkProjectFilterPermission(existing, permission)) {
      return false;
    }

    // if the updates include projects, check if the user has permission to update based on the new projects
    if (
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
    permission: EnvScopedPermission
  ): boolean {
    const projects = obj.projects?.length ? obj.projects : [""];

    return projects.every((project) =>
      this.hasPermission(permission, project, envs)
    );
  }

  private checkEnvFilterUpdatePermission(
    existing: { projects?: string[]; environment?: string },
    updates: { projects?: string[]; environment?: string },
    permission: EnvScopedPermission
  ): boolean {
    if (
      !this.checkEnvFilterPermission(
        existing,
        existing.environment ? [existing.environment] : [],
        permission
      )
    ) {
      return false;
    }

    const updatedObj = { ...existing, ...updates };

    return this.checkEnvFilterPermission(
      updatedObj,
      updatedObj.environment ? [updatedObj.environment] : [],
      permission
    );
  }

  private hasReadAccessForAtleast1Project = (): boolean => {
    const usersProjectRoles: { id: string; readAccess: boolean }[] = [];
    for (const project in this.userPermissions.projects) {
      usersProjectRoles.push({
        id: project,
        readAccess:
          this.userPermissions.projects[project].permissions.readData || false,
      });
    }

    // If the user doesn't have any project roles, return false
    if (!usersProjectRoles.length) return false;

    // Otherwise, check to see if they have read-access via one of their project roles
    // if so, they should have read access
    return usersProjectRoles.some((p) => this.hasPermission("readData", p.id));
  };

  private hasPermission(
    permissionToCheck: Permission,
    project: string,
    envs?: string[]
  ) {
    if (this.superAdmin) {
      return true;
    }

    const usersPermissionsToCheck =
      this.userPermissions.projects[project] || this.userPermissions.global;

    if (!usersPermissionsToCheck.permissions[permissionToCheck]) {
      return false;
    }

    if (!envs || !usersPermissionsToCheck.limitAccessByEnvironment) {
      return true;
    }
    return envs.every((env) =>
      usersPermissionsToCheck.environments.includes(env)
    );
  }
}
