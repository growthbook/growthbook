import {
  Permission,
  UserPermissions,
  PermissionsObject,
  OrganizationInterface,
  Role,
  ProjectMemberRole,
  MemberRoleInfo,
} from "back-end/types/organization";
import {
  DEFAULT_ROLES,
  ENV_SCOPED_PERMISSIONS,
  POLICY_PERMISSION_MAP,
  Policy,
  READ_ONLY_PERMISSIONS,
} from "./permissions.constants";

export function policiesSupportEnvLimit(policies: Policy[]): boolean {
  // If any policies have a permission that is env scoped, return true
  return policies.some((policy) =>
    POLICY_PERMISSION_MAP[policy]?.some((permission) =>
      ENV_SCOPED_PERMISSIONS.includes(
        permission as typeof ENV_SCOPED_PERMISSIONS[number]
      )
    )
  );
}

export function getPermissionsObjectByPolicies(
  policies: Policy[]
): PermissionsObject {
  const permissions: PermissionsObject = {};

  policies.forEach((policy) => {
    POLICY_PERMISSION_MAP[policy]?.forEach((permission) => {
      permissions[permission] = true;
    });
  });

  return permissions;
}

export function getRoleById(
  roleId: string,
  organization: OrganizationInterface
): Role | null {
  const roles = getRoles(organization);

  return roles.find((role) => role.id === roleId) || null;
}

export function getRoles(org: OrganizationInterface) {
  // Always start with noaccess and readonly
  const roles = [DEFAULT_ROLES.noaccess, DEFAULT_ROLES.readonly];

  // Role ids must be unique (admin is added at the end, which is why it's here)
  const usedIds = new Set(["noaccess", "readonly", "admin"]);

  // Add additional roles
  const customRoles =
    org.useCustomRoles && org.customRoles
      ? org.customRoles
      : Object.values(DEFAULT_ROLES);
  customRoles.forEach((role) => {
    if (usedIds.has(role.id)) return;
    usedIds.add(role.id);
    roles.push(role);
  });

  // Always add admin at the end
  roles.push(DEFAULT_ROLES.admin);

  return roles;
}

export function isRoleValid(role: string, org: OrganizationInterface) {
  return !!getRoleById(role, org);
}

export function areProjectRolesValid(
  projectRoles: ProjectMemberRole[] | undefined,
  org: OrganizationInterface
) {
  if (!projectRoles) {
    return true;
  }
  return projectRoles.every(
    (projectRole) => !!getRoleById(projectRole.role, org)
  );
}

export function getDefaultRole(org: OrganizationInterface): MemberRoleInfo {
  // First use the explicitly provided default role
  if (
    org.settings?.defaultRole?.role &&
    isRoleValid(org.settings.defaultRole.role, org)
  ) {
    return org.settings.defaultRole;
  }

  // Otherwise, try to use collaborator if it's valid
  if (isRoleValid("collaborator", org)) {
    return {
      role: "collaborator",
      environments: [],
      limitAccessByEnvironment: false,
    };
  }

  // Readonly is always valid
  return {
    role: "readonly",
    environments: [],
    limitAccessByEnvironment: false,
  };
}

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

export const userHasPermission = (
  superAdmin: boolean,
  userPermissions: UserPermissions,
  permission: Permission,
  project?: string | (string | undefined)[] | undefined,
  envs?: string[]
): boolean => {
  if (superAdmin) {
    return true;
  }

  let checkProjects: (string | undefined)[];
  if (Array.isArray(project)) {
    checkProjects = project.length > 0 ? project : [undefined];
  } else {
    checkProjects = [project];
  }

  if (READ_ONLY_PERMISSIONS.includes(permission)) {
    if (
      checkProjects.length === 1 &&
      checkProjects[0] === undefined &&
      Object.keys(userPermissions.projects).length
    ) {
      // add all of the projects the user has project-level roles for
      checkProjects.push(...Object.keys(userPermissions.projects));
    }
    // Read only type permissions grant permission if the user has the permission globally or in atleast 1 project
    return checkProjects.some((p) =>
      hasPermission(userPermissions, permission, p, envs)
    );
  } else {
    // All other permissions require the user to have the permission globally or the user must have the permission in every project they have specific permissions for
    return checkProjects.every((p) =>
      hasPermission(userPermissions, permission, p, envs)
    );
  }
};

export function roleSupportsEnvLimit(
  roleId: string,
  org: OrganizationInterface
): boolean {
  if (roleId === "admin") return false;

  const role = getRoleById(roleId, org);

  return policiesSupportEnvLimit(role?.policies || []);
}
