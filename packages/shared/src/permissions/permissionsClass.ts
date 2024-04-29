import { FeatureInterface } from "back-end/types/feature";
import { MetricInterface } from "back-end/types/metric";
import {
  GlobalPermission,
  Permission,
  ProjectScopedPermission,
  SDKAttribute,
  UserPermissions,
} from "back-end/types/organization";
import { IdeaInterface } from "back-end/types/idea";
import {
  FactTableInterface,
  UpdateFactTableProps,
} from "back-end/types/fact-table";
import { ExperimentInterface } from "back-end/types/experiment";
import { DataSourceInterface } from "back-end/types/datasource";
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

  //Required permission in order to delete reports created by other users
  public canSuperDeleteReport = (): boolean => {
    return this.checkGlobalPermission("superDeleteReport");
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

  public throwPermissionError(): void {
    throw new PermissionError(
      "You do not have permission to perform this action"
    );
  }

  private checkGlobalPermission(permission: GlobalPermission): boolean {
    return this.hasPermission(permission, "");
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
