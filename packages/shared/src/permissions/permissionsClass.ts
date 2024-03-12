import { MetricInterface } from "back-end/types/metric";
import { Permission, UserPermissions } from "back-end/types/organization";
class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}

export type PermissionsUtil = {
  canCreateMetrics: (metric: Pick<MetricInterface, "projects">) => boolean;
  throwPermissionError: (message?: string) => void;
};
export class permissionsClass {
  private userPermissions: UserPermissions;
  private superAdmin: boolean;
  constructor(permissions: UserPermissions, superAdmin: boolean) {
    this.userPermissions = permissions;
    this.superAdmin = superAdmin;
  }

  //TODO: When we add finer-grain permissions, update canCreateXYZ props to only accept array of projects (string[])
  public canCreateMetrics(metric: Pick<MetricInterface, "projects">): boolean {
    const metricProjects = metric.projects?.length ? metric.projects : [""];

    return metricProjects.every((project) =>
      this.hasPermission("createMetrics", project)
    );
  }

  public throwPermissionError(permission: Permission) {
    throw new PermissionError(
      `Permission Error: This action requires "${permission}" permission. Permissions are evaluated using your global role and, when applicable, your project-level role(s).`
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
