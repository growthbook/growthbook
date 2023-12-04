import { MetricInterface } from "back-end/types/metric";
import {
  Permission,
  UserPermissions,
  MemberRole,
} from "back-end/types/organization";
import { ProjectInterface } from "back-end/types/project";

export function hasPermission(
  userPermissions: UserPermissions | undefined,
  permissionToCheck: Permission,
  project?: string | undefined,
  envs?: string[]
): boolean {
  const usersPermissionsToCheck =
    (project && userPermissions?.projects[project]) || userPermissions?.global;

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

export function getProjectsUserCanAccess(
  currentUserPermissions: UserPermissions,
  projects: ProjectInterface[]
): ProjectInterface[] {
  // If the user's global permissions allow them to read data, set accessibleProjects to all projects
  const accessibleProjects: ProjectInterface[] = currentUserPermissions.global
    .permissions.readData
    ? projects
    : [];

  projects.forEach((project) => {
    const projectAccessibleIndex = accessibleProjects.findIndex(
      (accessibleProject) => accessibleProject.id === project.id
    );

    // Check if the user has specific permissions for this project
    const projectPermissions = currentUserPermissions.projects[project.id];

    //TODO: I don't think this logic will work in every scenario - if projectAccessibleIndex === -1, this will cause some errors, right?
    if (projectPermissions) {
      const projectReadAccess = projectPermissions.permissions.readData;
      if (projectAccessibleIndex !== -1 && !projectReadAccess) {
        // If the current project is in accessibleProjects array but the user's project-level role disallows read access, remove it
        accessibleProjects.splice(projectAccessibleIndex, 1);
      } else if (projectAccessibleIndex === -1 && projectReadAccess) {
        // if the current project is not in accessibleProjects but the user's project-level role allows read access, add it
        accessibleProjects.push(project);
      }
    }
  });

  return accessibleProjects;
}

export function getMetricsUserCanAccess(
  currentUserPermissions: UserPermissions,
  metrics: MetricInterface[]
): MetricInterface[] {
  const usersGlobalRoleHasReadPermissions =
    currentUserPermissions.global.permissions.readData;

  const accessibleMetrics: MetricInterface[] = usersGlobalRoleHasReadPermissions
    ? [...metrics]
    : [];

  const userHasProjectSpecificPermissions = !!Object.keys(
    currentUserPermissions.projects
  ).length;

  if (userHasProjectSpecificPermissions) {
    metrics.forEach((metric) => {
      const metricProjects = metric.projects || [];

      if (metricProjects.length === 0) {
        return;
      }

      if (usersGlobalRoleHasReadPermissions) {
        let userHasReadAccessToAtleastOneProject = false;
        // // global role gives them readAccess permissions, checking project-specific permissions to see if it revokes their readAccess
        metricProjects.forEach((metricProject) => {
          if (
            currentUserPermissions.projects[metricProject]?.permissions
              .readData === true
          ) {
            userHasReadAccessToAtleastOneProject = true;
          }
        });
        if (!userHasReadAccessToAtleastOneProject) {
          const metricIndex = accessibleMetrics.findIndex(
            (accessibleMetric) => accessibleMetric.id === metric.id
          );
          if (metricIndex !== -1) {
            accessibleMetrics.splice(metricIndex, 1);
          }
        }
      } else {
        // global role doesn't give them permissions, checking project-level permissions to see if it grants them readAccess
        if (
          metricProjects.some(
            (metricProject) =>
              currentUserPermissions.projects[metricProject]?.permissions
                .readData === true
          )
        ) {
          accessibleMetrics.push(metric);
        }
      }
    });
  }

  return accessibleMetrics;
}

export function roleSupportsEnvLimit(role: MemberRole): boolean {
  return ["engineer", "experimenter"].includes(role);
}
