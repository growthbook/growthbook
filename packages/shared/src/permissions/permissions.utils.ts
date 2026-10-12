import { isEqual, pick } from "lodash";
import {
  Permission,
  UserPermissions,
  PermissionsObject,
  OrganizationInterface,
  Role,
  ProjectMemberRole,
  MemberRoleInfo,
  MemberRoleWithProjects,
  UserPermission,
} from "shared/types/organization";
import { hasNoDuplicateProjects } from "../validators/organization";
import {
  DEFAULT_ROLES,
  ENV_SCOPED_PERMISSIONS,
  POLICY_PERMISSION_MAP,
  Policy,
  READ_ONLY_PERMISSIONS,
  RESERVED_ROLE_IDS,
} from "./permissions.constants";

export function policiesSupportEnvLimit(policies: Policy[]): boolean {
  const scoped = ENV_SCOPED_PERMISSIONS as readonly string[];
  return policies.some((policy) =>
    POLICY_PERMISSION_MAP[policy]?.some((permission) =>
      scoped.includes(permission),
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

// Effective permissions for a role. Policies are the only grant mechanism —
// atoms are an implementation detail of what a policy carries.
export function permissionsFromRole(
  role: Pick<Role, "policies">,
): PermissionsObject {
  return getPermissionsObjectByPolicies(role.policies || []);
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
  // One rule per project: duplicates union, granting more than was meant.
  if (!hasNoDuplicateProjects(projectRoles)) {
    return false;
  }
  return projectRoles.every(
    (p) =>
      isRoleValid(p.role, org) &&
      areAdditionalRolesValid(p.additionalRoles, org),
  );
}

export function areAdditionalRolesValid(
  additionalRoles: MemberRoleInfo["additionalRoles"],
  org: Partial<OrganizationInterface>,
) {
  return (additionalRoles ?? []).every((r) => isRoleValid(r.role, org));
}

// The role-bearing fields of a team, as the model and the REST bodies carry them.
export type TeamAuthority = {
  role: string;
  additionalRoles?: unknown[];
  projectRoles?: ProjectMemberRole[];
  managedByIdp?: boolean;
  managedBy?: unknown;
};

// A team that grants nothing outside its project roles, so every bit of
// authority on it is authority a Project Admin could already hand out to a
// member directly.
export function isProjectScopedTeam(team: TeamAuthority): boolean {
  return (
    team.role === "noaccess" &&
    !team.additionalRoles?.length &&
    !team.managedByIdp &&
    !team.managedBy
  );
}

export function teamProjects(team: TeamAuthority): string[] {
  return (team.projectRoles ?? []).map((rule) => rule.project);
}

// Stored records omit empty optional fields while request bodies spell them
// out, so an absent list, an empty list, and an undefined key all read alike.
export function sameRoleValue(a: unknown, b: unknown): boolean {
  return isEqual(emptyAsAbsent(a), emptyAsAbsent(b));
}

function emptyAsAbsent(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    return value.length ? value.map(emptyAsAbsent) : undefined;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, v]) => [key, emptyAsAbsent(v)] as const)
      .filter(([, v]) => v !== undefined);
    return Object.fromEntries(entries);
  }
  return value;
}

// Projects whose rule differs between two project-role lists: added, removed,
// or changed.
export function changedProjectRoleProjects(
  before: ProjectMemberRole[] | undefined,
  after: ProjectMemberRole[] | undefined,
): string[] {
  const byProject = (rules: ProjectMemberRole[] | undefined) =>
    new Map((rules ?? []).map((rule) => [rule.project, rule]));
  const previous = byProject(before);
  const next = byProject(after);
  return [...new Set([...previous.keys(), ...next.keys()])].filter(
    (project) => !sameRoleValue(previous.get(project), next.get(project)),
  );
}

const ROLE_RULE_FIELDS = [
  "role",
  "limitAccessByEnvironment",
  "environments",
] as const;

// Drops unknown keys and any non-array role list, so every consumer (reads,
// join sites, delete guard) gets a well-formed value. Malformed writes are
// rejected earlier by assertRoleListsAreArrays, not silently cleaned here.
export function pickDefaultRoleFields(
  defaultRole: MemberRoleWithProjects,
): MemberRoleWithProjects {
  const pickRules = (rules: unknown) =>
    Array.isArray(rules)
      ? rules.map((r) => pick(r, ROLE_RULE_FIELDS))
      : undefined;
  return {
    ...pick(defaultRole, ROLE_RULE_FIELDS),
    ...(defaultRole.additionalRoles
      ? { additionalRoles: pickRules(defaultRole.additionalRoles) }
      : {}),
    ...(Array.isArray(defaultRole.projectRoles)
      ? {
          projectRoles: defaultRole.projectRoles.map((p) => ({
            ...pick(p, [...ROLE_RULE_FIELDS, "project"]),
            ...(p.additionalRoles
              ? { additionalRoles: pickRules(p.additionalRoles) }
              : {}),
          })),
        }
      : {}),
  };
}

// A non-array role list would be dropped by pickDefaultRoleFields, silently
// discarding an override; reject it so a write reports the bad shape instead.
export function assertDefaultRoleListsAreArrays(
  defaultRole: MemberRoleWithProjects,
): void {
  const lists: unknown[] = [
    defaultRole.additionalRoles,
    defaultRole.projectRoles,
  ];
  if (Array.isArray(defaultRole.projectRoles)) {
    for (const p of defaultRole.projectRoles) lists.push(p.additionalRoles);
  }
  if (lists.some((list) => list != null && !Array.isArray(list))) {
    throw new Error("additionalRoles and projectRoles must be arrays");
  }
}

// Maps a transform over every role rule (top level, additionalRoles, and each
// projectRole plus its additionalRoles).
function mapRoleRules(
  defaultRole: MemberRoleWithProjects,
  fn: <
    T extends { limitAccessByEnvironment?: boolean; environments?: string[] },
  >(
    rule: T,
  ) => T,
): MemberRoleWithProjects {
  return {
    ...fn(defaultRole),
    ...(defaultRole.additionalRoles
      ? { additionalRoles: defaultRole.additionalRoles.map(fn) }
      : {}),
    ...(defaultRole.projectRoles
      ? {
          projectRoles: defaultRole.projectRoles.map((p) => ({
            ...fn(p),
            ...(p.additionalRoles
              ? { additionalRoles: p.additionalRoles.map(fn) }
              : {}),
          })),
        }
      : {}),
  };
}

// Legacy configs stored a role as just { role }; fill the required fields so it
// still validates instead of failing the whole import.
export function withDefaultRoleDefaults(
  defaultRole: MemberRoleWithProjects,
): MemberRoleWithProjects {
  return mapRoleRules(defaultRole, (rule) => ({
    ...rule,
    limitAccessByEnvironment: rule.limitAccessByEnvironment ?? false,
    environments: rule.environments ?? [],
  }));
}

// Drops references to environments that won't exist after the write, so an
// unchanged default role isn't left pointing at a removed environment.
export function pruneRoleEnvironments(
  defaultRole: MemberRoleWithProjects,
  validEnvironments: string[],
): MemberRoleWithProjects {
  const valid = new Set(validEnvironments);
  return mapRoleRules(defaultRole, (rule) => ({
    ...rule,
    ...(rule.environments
      ? { environments: rule.environments.filter((e) => valid.has(e)) }
      : {}),
  }));
}

export function normalizeDefaultRole(
  defaultRole: MemberRoleWithProjects,
  org: Partial<OrganizationInterface>,
): MemberRoleWithProjects {
  return normalizeStaleRoleRules(pickDefaultRoleFields(defaultRole), org);
}

// A custom role deleted while referenced here must not block automated joins
function normalizeStaleRoleRules(
  defaultRole: MemberRoleWithProjects,
  org: Partial<OrganizationInterface>,
): MemberRoleWithProjects {
  const validRules = <T extends { role: string }>(rules: T[] | undefined) =>
    rules?.filter((r) => isRoleValid(r.role, org));
  return {
    ...defaultRole,
    ...(defaultRole.additionalRoles
      ? { additionalRoles: validRules(defaultRole.additionalRoles) }
      : {}),
    ...(defaultRole.projectRoles
      ? {
          projectRoles: defaultRole.projectRoles.map((p) => ({
            ...p,
            // Removing the override would grant the global role in this project.
            role: isRoleValid(p.role, org) ? p.role : "noaccess",
            ...(p.additionalRoles
              ? { additionalRoles: validRules(p.additionalRoles) }
              : {}),
          })),
        }
      : {}),
  };
}

export function getDefaultRole(
  org: Partial<OrganizationInterface>,
): MemberRoleWithProjects {
  // First try the explicitly provided default role
  if (
    org.settings?.defaultRole?.role &&
    isRoleValid(org.settings.defaultRole.role, org)
  ) {
    return normalizeDefaultRole(org.settings.defaultRole, org);
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

  return envsAllowedBy(usersPermissionsToCheck, permissionToCheck, envs);
}

// Environments a permission covers (null = all): the union across relevant
// grants, falling back to the merged legacy fields only when none exist.
export function allowedEnvironments(
  userPermission: UserPermission,
  permissionToCheck: Permission,
): string[] | null {
  const relevantGrants = (userPermission.envGrants ?? []).filter((g) =>
    g.permissions.includes(permissionToCheck),
  );
  if (relevantGrants.length) {
    if (relevantGrants.some((g) => !g.limitAccessByEnvironment)) return null;
    return [...new Set(relevantGrants.flatMap((g) => g.environments))];
  }
  return userPermission.limitAccessByEnvironment
    ? userPermission.environments
    : null;
}

export function envsAllowedBy(
  userPermission: UserPermission,
  permissionToCheck: Permission,
  envs?: string[],
): boolean {
  if (!envs) return true;
  const allowed = allowedEnvironments(userPermission, permissionToCheck);
  return allowed === null || envs.every((env) => allowed.includes(env));
}

// Unbound changes need this: an empty footprint would otherwise pass vacuously.
export function hasUnrestrictedEnvAuthority(
  userPermission: UserPermission,
  permissionToCheck: Permission,
): boolean {
  return allowedEnvironments(userPermission, permissionToCheck) === null;
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
    // Read only type permissions grant permission if the user has the permission globally or in at least 1 project
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

export function envScopedPermissionsForRole(
  roleId: string,
  org: Partial<OrganizationInterface>,
): Permission[] {
  if (["admin", "gbDefault_projectAdmin"].includes(roleId)) return [];

  const role = getRoleById(roleId, org);
  if (!role) return [];

  const permissions = permissionsFromRole(role);
  return ENV_SCOPED_PERMISSIONS.filter((p) => permissions[p]);
}

export function roleSupportsEnvLimit(
  roleId: string,
  org: Partial<OrganizationInterface>,
): boolean {
  return envScopedPermissionsForRole(roleId, org).length > 0;
}

export function roleToPermissionMap(
  roleId: string,
  org: OrganizationInterface,
): PermissionsObject {
  const role = getRoleById(roleId || "readonly", org);
  if (!role) return {};
  return permissionsFromRole(role);
}

export type EnvLimitedRule = {
  role: string;
  limitAccessByEnvironment?: boolean;
  environments?: string[];
};

export type EffectiveRoleSource = {
  role: string;
  sourceType: "user" | "team";
  sourceName: string;
  limitAccessByEnvironment: boolean;
  environments: string[];
};

// Resolve the roles that actually apply to a member, combining their own role
// with any teams they're on, using the same precedence as the back-end
// permission merge (mergeUserAndTeamPermissions): an explicit project-scoped
// role — from the member or any team — takes precedence over global roles for
// that project, and only when no explicit project role applies do global roles
// contribute. The result is the set of contributing roles (a union, which may
// be more than one role). Pass `project = null` to resolve global roles.
export function getEffectiveRolesForProject(
  member: Pick<MemberRoleInfo, "role"> & {
    limitAccessByEnvironment?: boolean;
    environments?: string[];
    projectRoles?: ProjectMemberRole[];
    teams?: string[];
    additionalRoles?: EnvLimitedRule[];
  },
  project: string | null,
  teams: {
    id: string;
    name: string;
    role: string;
    limitAccessByEnvironment?: boolean;
    environments?: string[];
    projectRoles?: ProjectMemberRole[];
    additionalRoles?: EnvLimitedRule[];
  }[],
): EffectiveRoleSource[] {
  const teamsById = new Map(teams.map((t) => [t.id, t]));

  const principals: {
    sourceType: "user" | "team";
    sourceName: string;
    role: string;
    limitAccessByEnvironment?: boolean;
    environments?: string[];
    additionalRoles?: EnvLimitedRule[];
    projectRoles?: ProjectMemberRole[];
  }[] = [
    {
      sourceType: "user",
      sourceName: "user",
      role: member.role,
      limitAccessByEnvironment: member.limitAccessByEnvironment,
      environments: member.environments,
      additionalRoles: member.additionalRoles,
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
        limitAccessByEnvironment: team.limitAccessByEnvironment,
        environments: team.environments,
        additionalRoles: team.additionalRoles,
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
    // Additional rules grant alongside their base role, and a project override
    // replaces the global one wholesale — its own additional rules included.
    const applicable = projectRole ?? p;
    const rules = [applicable, ...(applicable.additionalRoles || [])];
    const target = projectRole ? explicit : globals;
    rules.forEach((rule) =>
      target.push({
        role: rule.role,
        sourceType,
        sourceName,
        limitAccessByEnvironment: !!rule.limitAccessByEnvironment,
        environments: rule.environments || [],
      }),
    );
  });

  // An explicit project role takes precedence over global roles, so only fall
  // back to global roles when no explicit project role applies.
  return explicit.length ? explicit : globals;
}

// True if any of the role's policies carries an environment-scoped atom.
export function roleSupportsEnvLimitFromRole(
  role: Pick<Role, "policies">,
): boolean {
  return policiesSupportEnvLimit(role.policies || []);
}
