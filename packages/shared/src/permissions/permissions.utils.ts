import {
  Permission,
  UserPermissions,
  PermissionsObject,
  OrganizationInterface,
  Role,
  ProjectMemberRole,
  MemberRoleInfo,
} from "shared/types/organization";
import {
  DEFAULT_ROLES,
  ENV_SCOPED_PERMISSIONS,
  POLICY_PERMISSION_MAP,
  Policy,
  READ_ONLY_PERMISSIONS,
  RESERVED_ROLE_IDS,
} from "./permissions.constants";

export function policiesSupportEnvLimit(policies: Policy[]): boolean {
  // If any policies have a permission that is env scoped, return true
  return policies.some((policy) =>
    POLICY_PERMISSION_MAP[policy]?.some((permission) =>
      ENV_SCOPED_PERMISSIONS.includes(
        permission as (typeof ENV_SCOPED_PERMISSIONS)[number],
      ),
    ),
  );
}

export function getPermissionsObjectByPolicies(
  policies: Policy[],
): PermissionsObject {
  const permissions: PermissionsObject = {};

  policies.forEach((policy) => {
    POLICY_PERMISSION_MAP[policy]?.forEach((permission) => {
      permissions[permission] = true;
    });
  });

  return permissions;
}

// Effective permissions for a role: the union of its policy-derived permissions
// and any additive fine-grained permission atoms (role.permissions).
export function permissionsFromRole(
  role: Pick<Role, "policies"> & { permissions?: Permission[] },
): PermissionsObject {
  const permissions = getPermissionsObjectByPolicies(role.policies || []);
  (role.permissions || []).forEach((permission) => {
    permissions[permission] = true;
  });
  return permissions;
}

// Whether a role can be limited by environment: true if any policy OR any
// additive permission is environment-scoped.
export function roleSupportsEnvLimitFromRole(
  role: Pick<Role, "policies"> & { permissions?: Permission[] },
): boolean {
  if (policiesSupportEnvLimit(role.policies || [])) return true;
  return (role.permissions || []).some((permission) =>
    ENV_SCOPED_PERMISSIONS.includes(
      permission as (typeof ENV_SCOPED_PERMISSIONS)[number],
    ),
  );
}

export function getRoleById(
  roleId: string,
  organization: Partial<OrganizationInterface>,
): Role | null {
  const roles = getRoles(organization);

  return roles.find((role) => role.id === roleId) || null;
}

export function getRoleDisplayName(
  roleId: string,
  organization: Partial<OrganizationInterface>,
): string {
  const role = getRoleById(roleId, organization);
  return role?.displayName || roleId;
}

export function getRoles(org: Partial<OrganizationInterface>) {
  // Always start with default roles
  const roles = Object.values(DEFAULT_ROLES);

  // TODO: Allow orgs to remove/disable some default roles

  // Role ids must be unique, keep track of used ids
  const usedIds = new Set(RESERVED_ROLE_IDS);

  // Add additional custom roles
  if (org.customRoles?.length) {
    org.customRoles.forEach((role) => {
      if (usedIds.has(role.id)) return;
      usedIds.add(role.id);
      roles.push(role);
    });
  }

  return roles;
}

export function isRoleValid(role: string, org: Partial<OrganizationInterface>) {
  return !!getRoleById(role, org);
}

export function areProjectRolesValid(
  projectRoles: ProjectMemberRole[] | undefined,
  org: Partial<OrganizationInterface>,
) {
  if (!projectRoles) {
    return true;
  }
  return projectRoles.every((p) => isRoleValid(p.role, org));
}

export function getDefaultRole(
  org: Partial<OrganizationInterface>,
): MemberRoleInfo {
  // First try the explicitly provided default role
  if (
    org.settings?.defaultRole?.role &&
    isRoleValid(org.settings.defaultRole.role, org)
  ) {
    return org.settings.defaultRole;
  }

  // Fall back to using "collaborator"
  // TODO: If we allow disabling roles, check to make sure "collaborator" is enabled
  return {
    role: "collaborator",
    environments: [],
    limitAccessByEnvironment: false,
  };
}

export function hasPermission(
  userPermissions: UserPermissions | undefined,
  permissionToCheck: Permission,
  project?: string | undefined,
  envs?: string[],
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
    usersPermissionsToCheck.environments.includes(env),
  );
}

export const userHasPermission = (
  userPermissions: UserPermissions,
  permission: Permission,
  project?: string | (string | undefined)[] | undefined,
  envs?: string[],
): boolean => {
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
      hasPermission(userPermissions, permission, p, envs),
    );
  } else {
    // All other permissions require the user to have the permission globally or the user must have the permission in every project they have specific permissions for
    return checkProjects.every((p) =>
      hasPermission(userPermissions, permission, p, envs),
    );
  }
};

export function roleSupportsEnvLimit(
  roleId: string,
  org: Partial<OrganizationInterface>,
): boolean {
  if (["admin", "gbDefault_projectAdmin"].includes(roleId)) return false;

  const role = getRoleById(roleId, org);
  if (!role) return false;

  return roleSupportsEnvLimitFromRole(role);
}

export function roleToPermissionMap(
  roleId: string,
  org: OrganizationInterface,
): PermissionsObject {
  const role = getRoleById(roleId || "readonly", org);
  if (!role) return {};
  return permissionsFromRole(role);
}

export type EffectiveRoleSource = {
  role: string;
  sourceType: "user" | "team";
  sourceName: string;
};

/**
 * Resolve the roles that actually apply to a member, combining their own role
 * with any teams they're on, using the same precedence as the back-end
 * permission merge (mergeUserAndTeamPermissions): an explicit project-scoped
 * role — from the member or any team — takes precedence over global roles for
 * that project, and only when no explicit project role applies do global roles
 * contribute. The result is the set of contributing roles (a union, which may
 * be more than one role). Pass `project = null` to resolve global roles.
 */
export function getEffectiveRolesForProject(
  member: Pick<MemberRoleInfo, "role"> & {
    projectRoles?: ProjectMemberRole[];
    teams?: string[];
  },
  project: string | null,
  teams: {
    id: string;
    name: string;
    role: string;
    projectRoles?: ProjectMemberRole[];
  }[],
): EffectiveRoleSource[] {
  const teamsById = new Map(teams.map((t) => [t.id, t]));

  const principals: {
    sourceType: "user" | "team";
    sourceName: string;
    role: string;
    projectRoles?: ProjectMemberRole[];
  }[] = [
    {
      sourceType: "user",
      sourceName: "user",
      role: member.role,
      projectRoles: member.projectRoles,
    },
  ];
  (member.teams || []).forEach((teamId) => {
    const team = teamsById.get(teamId);
    if (team) {
      principals.push({
        sourceType: "team",
        sourceName: team.name,
        role: team.role,
        projectRoles: team.projectRoles,
      });
    }
  });

  const explicit: EffectiveRoleSource[] = [];
  const globals: EffectiveRoleSource[] = [];
  principals.forEach((p) => {
    const projectRole = project
      ? p.projectRoles?.find((r) => r.project === project)
      : undefined;
    const { sourceType, sourceName } = p;
    if (projectRole) {
      explicit.push({ role: projectRole.role, sourceType, sourceName });
    } else {
      globals.push({ role: p.role, sourceType, sourceName });
    }
  });

  // An explicit project role takes precedence over global roles, so only fall
  // back to global roles when no explicit project role applies.
  return explicit.length ? explicit : globals;
}
