import { MetricInterface } from "back-end/types/metric";
import { Permission, UserPermissions } from "back-end/types/organization";
class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}
export class permissionsClass {
  private userPermissions: UserPermissions;
  private superAdmin: boolean;
  constructor(permissions: UserPermissions, superAdmin: boolean) {
    this.userPermissions = permissions;
    this.superAdmin = superAdmin;
  }

  //TODO: When we add finer-grain permissions, update props to only accept an array of projects, or a single project string for "create" type resources
  public canCreateMetrics(metric: Pick<MetricInterface, "projects">): boolean {
    const metricProjects = metric.projects?.length ? metric.projects : [""];

    return metricProjects.every((project) =>
      this.hasPermission("createMetrics", project)
    );
  }

  public throwPermissionError(message?: string) {
    throw new PermissionError(
      message || `You do not have permission to perform this action.`
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
      (project && this.userPermissions.projects[project]) ||
      this.userPermissions.global;

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
}
