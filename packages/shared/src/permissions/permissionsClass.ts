import { FeatureInterface } from "back-end/types/feature";
import { MetricInterface } from "back-end/types/metric";
import { Permission, UserPermissions } from "back-end/types/organization";
import { IdeaInterface } from "back-end/types/idea";
import {
  FactTableInterface,
  UpdateFactTableProps,
} from "back-end/types/fact-table";
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

  // This is a helper method to use on the frontend to determine whether or not to show certain UI elements
  public canViewIdeaModal = (project?: string): boolean => {
    return this.checkProjectFilterPermission(
      {
        projects: project ? [project] : [],
      },
      "createIdeas"
    );
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

  // This is a helper method to use on the frontend to determine whether or not a user can create Fact Tables in current project
  public canViewCreateFactTableModal = (project?: string): boolean => {
    return this.checkProjectFilterPermission(
      {
        projects: project ? [project] : [],
      },
      "manageFactTables"
    );
  };

  // This is a helper method to use on the frontend to determine whether or not a user can edit a Fact Table
  public canViewEditFactTableModal = (
    factTable: Pick<FactTableInterface, "projects">
  ): boolean => {
    return this.checkProjectFilterPermission(factTable, "manageFactTables");
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

  public canBypassApprovalChecks = (
    feature: Pick<FeatureInterface, "project">
  ): boolean => {
    return this.checkProjectFilterPermission(
      { projects: feature.project ? [feature.project] : [] },
      "bypassApprovalChecks"
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

  public canAddComment = (projects: string[]): boolean => {
    return this.checkProjectFilterPermission({ projects }, "addComments");
  };

  public throwPermissionError(): void {
    throw new PermissionError(
      "You do not have permission to perform this action"
    );
  }

  private checkProjectFilterPermission(
    obj: { projects?: string[] },
    permission: Permission
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
    permission: Permission
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
