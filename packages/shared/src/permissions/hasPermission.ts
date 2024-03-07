import { MetricInterface } from "back-end/types/metric";
import { Permission, UserPermissions } from "back-end/types/organization";

class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}

export class hasPermissionClass {
  private userPermissions: UserPermissions;
  //TODO: Change this to permissions: UserPermissions | undefined - I could then update hasPermission to immediately return false if no userPermissions
  // This will make invoking the class easier
  constructor(permissions: UserPermissions) {
    this.userPermissions = permissions;
  }

  public canCreateMetrics(metric: Pick<MetricInterface, "projects">) {
    const metricProjects = metric.projects || [""];

    const hasPermission = metricProjects.some((project) =>
      this.hasPermission("createMetrics", project)
    );

    return this.transformReturnObj(hasPermission);
  }

  protected transformReturnObj(hasPermission: boolean) {
    return {
      hasPermission,
      throwIfError: () => {
        if (hasPermission) {
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
