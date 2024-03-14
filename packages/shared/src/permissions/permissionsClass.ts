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
    existing: Pick<MetricInterface, "projects" | "managedBy">,
    updated: Pick<MetricInterface, "projects">
  ): boolean {
    if (existing.managedBy) return false;

    const currentMetricProjects = existing.projects?.length
      ? existing.projects
      : [""];

    const canUpdateExisting = currentMetricProjects.every((project) =>
      this.hasPermission("createMetrics", project)
    );

    if (!canUpdateExisting) {
      return false;
    }

    let hasPermission = true;

    // if updated.projects is undefined, the user isn't trying to update the projects, so we can return true
    if (updated.projects) {
      const updatedMetricProjects = updated.projects?.length
        ? updated.projects
        : [""];

      hasPermission = updatedMetricProjects.every((project) =>
        this.hasPermission("createMetrics", project)
      );
    }

    return hasPermission;
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
