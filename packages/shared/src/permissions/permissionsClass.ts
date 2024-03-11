import { MetricInterface } from "back-end/types/metric";
import { Permission, UserPermissions } from "back-end/types/organization";

export interface PermissionResult {
  hasPermission: boolean;
  throwIfError: () => void;
}

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

  //TODO: When we add finer-grain permissions, update props to only accept an array of projects, or a single project string
  public canCreateMetrics(
    metric: Pick<MetricInterface, "projects">
  ): PermissionResult {
    const metricProjects = metric.projects?.length ? metric.projects : [""];

    return this.transformReturnObj(
      metricProjects.every((project) =>
        this.hasPermission("createMetrics", project)
      )
    );
  }

  //TODO: When we add finer-grain permissions, update to accept the permission to check.
  // currently, it doesn't make sense since, we check for "createMetrics" when deciding if someone can delete a metric
  // that error could cause confusion
  protected transformReturnObj(hasPermission: boolean): PermissionResult {
    return {
      hasPermission,
      throwIfError: () => {
        if (!hasPermission) {
          throw new PermissionError(
            `You do not have permission to perform this action.`
          );
        }
      },
    };
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
