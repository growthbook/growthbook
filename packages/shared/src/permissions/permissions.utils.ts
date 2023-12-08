import {
  MemberRole,
  Permission,
  UserPermissions,
} from "back-end/types/organization";

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

export function roleSupportsEnvLimit(role: MemberRole): boolean {
  return ["engineer", "experimenter"].includes(role);
}

export function isValidUserRole(role: MemberRole) {
  const validRoles: Record<MemberRole, boolean> = {
    readonly: true,
    collaborator: true,
    designer: true,
    analyst: true,
    developer: true,
    engineer: true,
    experimenter: true,
    admin: true,
    scim: false,
  };
  return validRoles[role] || false;
}

export function isValidApiKeyRole(role: MemberRole) {
  const validRoles: Record<MemberRole, boolean> = {
    readonly: true,
    collaborator: false,
    designer: false,
    analyst: false,
    developer: false,
    engineer: false,
    experimenter: false,
    admin: true,
    scim: true,
  };
  return validRoles[role] || false;
}
