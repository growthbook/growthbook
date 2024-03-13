import { MetricInterface } from "back-end/types/metric";
import { Permission, UserPermissions } from "back-end/types/organization";
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

  public canCreateMetric(metric: Pick<MetricInterface, "projects">): boolean {
    const metricProjects = metric.projects?.length ? metric.projects : [""];

    return metricProjects.every((project) =>
      this.hasPermission("createMetrics", project)
    );
  }

  public canUpdateMetric(
    currentMetric: Pick<MetricInterface, "projects">,
    updatedMetric: Pick<MetricInterface, "projects">
  ): boolean {
    //TODO: Need to check that the user has permission to update the existing metric
    //TODO: Need to check that the user has permission to create metrics for the new projects
    return true;
  }

  public canDeleteMetric(
    metric: Pick<MetricInterface, "projects" | "managedBy">
  ): boolean {
    if (metric.managedBy) return false;
    const metricProjects = metric.projects?.length ? metric.projects : [""];

    return metricProjects.every((project) =>
      this.hasPermission("createMetrics", project)
    );
  }

  public throwPermissionError(): void {
    throw new PermissionError(
      "You do not have permission to perform this action"
    );
  }

  protected hasPermission(
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
