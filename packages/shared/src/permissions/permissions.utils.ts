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

export function roleSupportsEnvLimit(role: MemberRole): boolean {
  return ["engineer", "experimenter"].includes(role);
}
