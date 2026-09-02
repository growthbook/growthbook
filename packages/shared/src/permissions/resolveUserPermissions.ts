import { cloneDeep } from "lodash";
import type { ReviewAuthorityFootprint } from "shared/util";
import {
  MemberRoleWithProjects,
  OrganizationInterface,
  Permission,
  PermissionsObject,
  UserPermission,
  UserPermissions,
} from "shared/types/organization";
import { TeamInterface } from "shared/types/team";

// Role-bearing fields only, so the front end can resolve without member lists.
export type RoleSourceTeam = Pick<
  TeamInterface,
  | "id"
  | "role"
  | "limitAccessByEnvironment"
  | "environments"
  | "additionalRoles"
  | "projectRoles"
>;
import {
  ALL_PERMISSIONS,
  ENV_SCOPED_PERMISSIONS,
} from "./permissions.constants";
import { Permissions } from "./permissionsClass";
import type { RevisionModel } from "./revisionPermissions";
import { roleSupportsEnvLimit, roleToPermissionMap } from "./permissions.utils";

function hasEnvScopedPermissions(userPermission: PermissionsObject): boolean {
  const envLimitedPermissions: readonly Permission[] = ENV_SCOPED_PERMISSIONS;

  for (const permission of envLimitedPermissions) {
    if (userPermission[permission]) {
      return true;
    }
  }
  return false;
}

function isValidPermission(permission: string): permission is Permission {
  return ALL_PERMISSIONS.includes(permission as Permission);
}

function mergePermissions(
  existingPermissions: PermissionsObject,
  newPermissions: PermissionsObject,
): PermissionsObject {
  const updatedPermissions: PermissionsObject = { ...existingPermissions };

  for (const permission in newPermissions) {
    if (isValidPermission(permission) && newPermissions[permission] === true) {
      updatedPermissions[permission] = true;
    }
  }

  return updatedPermissions;
}

function mergeEnvironmentLimits(
  existingPermissions: UserPermission,
  newPermissions: UserPermission,
  org: OrganizationInterface,
): UserPermission {
  const existingRoleSupportsEnvLimits = hasEnvScopedPermissions(
    existingPermissions.permissions,
  );
  const newRoleSupportsEnvLimits = hasEnvScopedPermissions(
    newPermissions.permissions,
  );

  if (!existingRoleSupportsEnvLimits && !newRoleSupportsEnvLimits) {
    // Neither role supports env limits, so we can skip logic below
    return existingPermissions;
  }

  const updatedPermissions = cloneDeep(existingPermissions);

  if (
    // If the existingRole & newRole can be limited by environment
    existingRoleSupportsEnvLimits &&
    newRoleSupportsEnvLimits
  ) {
    if (
      // and if limitAccessByEnvironment is the same for new and existing roles, we just concat the envs arrays
      updatedPermissions.limitAccessByEnvironment ===
      newPermissions.limitAccessByEnvironment
    ) {
      updatedPermissions.environments = [
        ...new Set(
          updatedPermissions.environments.concat(newPermissions.environments),
        ),
      ];
      updatedPermissions.limitAccessByEnvironment = getLimitAccessByEnvironment(
        updatedPermissions.environments,
        updatedPermissions.limitAccessByEnvironment,
        org,
      );
    } else {
      // otherwise, 1 role doesn't have limited access by environment, so it overrides the other
      updatedPermissions.limitAccessByEnvironment = false;
      updatedPermissions.environments = [];
    }
  } else {
    // Only override existing role's env limits if the existing role doesn't support env limits, and the newRole does
    if (!existingRoleSupportsEnvLimits && newRoleSupportsEnvLimits) {
      updatedPermissions.limitAccessByEnvironment = getLimitAccessByEnvironment(
        newPermissions.environments,
        newPermissions.limitAccessByEnvironment,
        org,
      );

      updatedPermissions.environments = newPermissions.environments;
    }
  }
  return updatedPermissions;
}

function mergeUserPermissionObj(
  userPermission1: UserPermission,
  userPermission2: UserPermission,
  org: OrganizationInterface,
): UserPermission {
  let updatedUserPermissionObj = userPermission1;

  updatedUserPermissionObj = mergeEnvironmentLimits(
    updatedUserPermissionObj,
    userPermission2,
    org,
  );
  updatedUserPermissionObj.permissions = mergePermissions(
    updatedUserPermissionObj.permissions,
    userPermission2.permissions,
  );
  if (updatedUserPermissionObj.envGrants || userPermission2.envGrants) {
    updatedUserPermissionObj.envGrants = [
      ...(updatedUserPermissionObj.envGrants ?? []),
      ...(userPermission2.envGrants ?? []),
    ];
  }

  return updatedUserPermissionObj;
}

function mergeUserAndTeamPermissions(
  userPermissions: UserPermissions,
  teamPermissions: UserPermissions,
  org: OrganizationInterface,
) {
  // Build a list of all projects
  const allProjects = new Set([
    ...Object.keys(userPermissions.projects),
    ...Object.keys(teamPermissions.projects),
  ]);

  // A project role beats a global one, so a principal without a project role
  // contributes nothing here rather than leaking its global permissions in.
  const noProjectRole = (): UserPermission => ({
    limitAccessByEnvironment: false,
    environments: [],
    permissions: {},
  });
  allProjects.forEach((project) => {
    userPermissions.projects[project] = mergeUserPermissionObj(
      userPermissions.projects[project] || noProjectRole(),
      teamPermissions.projects[project] || noProjectRole(),
      org,
    );
  });

  // Merge the global permissions
  userPermissions.global = mergeUserPermissionObj(
    userPermissions.global,
    teamPermissions.global,
    org,
  );
}

function getLimitAccessByEnvironment(
  environments: string[],
  limitAccessByEnvironment: boolean,
  org: OrganizationInterface,
): boolean {
  // All environments selected == not limited. Guard the empty case: `every` on
  // [] is vacuously true, which would read as "all" and drop the restriction.
  const validEnvs = org.settings?.environments?.map((e) => e.id) || [];
  if (
    limitAccessByEnvironment &&
    validEnvs.length > 0 &&
    validEnvs.every((e) => environments?.includes(e))
  ) {
    return false;
  }

  return limitAccessByEnvironment;
}

function getUserPermission(
  info: {
    environments?: string[];
    limitAccessByEnvironment?: boolean;
    role: string;
    additionalRoles?: {
      role: string;
      limitAccessByEnvironment: boolean;
      environments: string[];
    }[];
  },
  org: OrganizationInterface,
): UserPermission {
  return (info.additionalRoles ?? []).reduce(
    (acc, rule) =>
      mergeUserPermissionObj(acc, getSingleRolePermission(rule, org), org),
    getSingleRolePermission(info, org),
  );
}

function getSingleRolePermission(
  info: {
    environments?: string[];
    limitAccessByEnvironment?: boolean;
    role: string;
  },
  org: OrganizationInterface,
): UserPermission {
  let limitAccessByEnvironment = !!info.limitAccessByEnvironment;

  // Only some roles can be limited by environment
  // TODO: This will have to change when we support custom roles
  if (limitAccessByEnvironment && !roleSupportsEnvLimit(info.role, org)) {
    limitAccessByEnvironment = false;
  }

  const permissions = roleToPermissionMap(info.role, org);
  const environments = info.environments || [];
  const effectiveLimit = getLimitAccessByEnvironment(
    environments,
    limitAccessByEnvironment,
    org,
  );
  const envScoped = ENV_SCOPED_PERMISSIONS.filter((p) => permissions[p]);
  return {
    environments,
    limitAccessByEnvironment: effectiveLimit,
    permissions,
    // Per-role grants, so two roles' restrictions can't cross-contaminate.
    // Omitted, not [], so roles granting nothing env-scoped keep their shape.
    ...(envScoped.length
      ? {
          envGrants: [
            {
              environments,
              limitAccessByEnvironment: effectiveLimit,
              permissions: envScoped,
            },
          ],
        }
      : {}),
  };
}

// Access-restricted projects deny by default: a principal with no explicit
// role there gets an empty project entry, which project-scoped checks resolve
// to instead of the global fall-through. manageTeam holders are exempt — they
// could grant themselves a project role anyway.
function applyProjectAccessRestrictions(
  permissions: UserPermissions,
  restrictedProjects: string[] | undefined,
): void {
  if (!restrictedProjects?.length) return;
  if (permissions.global.permissions.manageTeam) return;
  for (const project of restrictedProjects) {
    if (!permissions.projects[project]) {
      permissions.projects[project] = {
        limitAccessByEnvironment: false,
        environments: [],
        permissions: {},
      };
    }
  }
}

// Used for both org API keys and member records.
export function getRolePermissions(
  roleInfo: MemberRoleWithProjects,
  org: OrganizationInterface,
  allTeams: RoleSourceTeam[],
  restrictedProjects?: string[],
): UserPermissions {
  const permissions: UserPermissions = {
    global: getUserPermission(roleInfo, org),
    projects: {},
  };

  if (roleInfo.projectRoles) {
    for (const pr of roleInfo.projectRoles) {
      const existing = permissions.projects[pr.project];
      const next = getUserPermission(pr, org);
      permissions.projects[pr.project] = existing
        ? mergeUserPermissionObj(existing, next, org)
        : next;
    }
  }

  if (roleInfo.teams) {
    for (const teamId of roleInfo.teams) {
      const teamData = allTeams.find((t) => t.id === teamId);
      if (teamData) {
        const teamPermissions: UserPermissions = {
          global: getUserPermission(teamData, org),
          projects: {},
        };
        if (teamData.projectRoles) {
          for (const tp of teamData.projectRoles) {
            const existing = teamPermissions.projects[tp.project];
            const next = getUserPermission(tp, org);
            teamPermissions.projects[tp.project] = existing
              ? mergeUserPermissionObj(existing, next, org)
              : next;
          }
        }
        mergeUserAndTeamPermissions(permissions, teamPermissions, org);
      }
    }
  }

  applyProjectAccessRestrictions(permissions, restrictedProjects);

  return permissions;
}

// Shared so hook props and the required-approver gate agree on "in team X".
export function teamsForMember(
  userId: string,
  org: { members?: { id: string; teams?: string[] }[] },
  teams: { id: string; name: string }[],
): { id: string; name: string }[] {
  const member = (org.members ?? []).find((m) => m.id === userId);
  if (!member?.teams?.length) return [];
  const byId = new Map(teams.map((t) => [t.id, t]));
  return member.teams
    .map((id) => byId.get(id))
    .filter((t): t is { id: string; name: string } => !!t)
    .map((t) => ({ id: t.id, name: t.name }));
}

// ANY team within a rule satisfies it; EVERY rule must be satisfied.
export function assessRequiredApproverTeams({
  rules,
  coveringApproverIds,
  org,
  teams,
}: {
  rules: { requiredApproverTeams?: string[] }[];
  coveringApproverIds: string[];
  org: { members?: { id: string; teams?: string[] }[] };
  teams: { id: string; name: string }[];
}): {
  satisfied: boolean;
  // One entry per unsatisfied rule; any ONE of its teams would satisfy it.
  unmet: { id: string; name: string }[][];
  // The team sets actually enforced, after dropping implied rules. Callers that
  // judge whether one approval contributes must use these, not the raw rules.
  enforcedTeamIds: string[][];
} {
  const approverTeamIds = new Set(
    coveringApproverIds.flatMap((id) =>
      teamsForMember(id, org, teams).map((t) => t.id),
    ),
  );

  const byId = new Map(teams.map((t) => [t.id, t]));

  // Drop rules implied by a stricter one: satisfying a subset rule satisfies
  // the superset, so listing both reads as two sign-offs. Deleted teams are
  // excluded first so an emptied rule can't subsume one that still binds.
  const withSets = rules
    .map(
      (rule) =>
        new Set(
          (rule.requiredApproverTeams ?? []).filter((id) => byId.has(id)),
        ),
    )
    .filter((set) => set.size > 0);
  const effective = withSets.filter(
    (set, i) =>
      !withSets.some(
        (other, j) =>
          j !== i &&
          other.size <= set.size &&
          [...other].every((id) => set.has(id)) &&
          (other.size < set.size || j < i),
      ),
  );

  const unmet: { id: string; name: string }[][] = [];
  for (const set of effective) {
    const required = [...set];
    if (required.some((teamId) => approverTeamIds.has(teamId))) continue;
    unmet.push(
      required
        .map((id) => byId.get(id))
        .filter((t): t is { id: string; name: string } => !!t)
        .map((t) => ({ id: t.id, name: t.name })),
    );
  }

  // A rule naming only deleted teams can be neither satisfied nor explained.
  const actionable = unmet.filter((teamList) => teamList.length > 0);
  return {
    satisfied: actionable.length === 0,
    unmet: actionable,
    enforcedTeamIds: effective.map((set) => [...set]),
  };
}

// Uses CURRENT rules — an approval is not a snapshot of authority.
export function assessApprovalCoverage({
  org,
  teams,
  model,
  projects,
  footprint,
  approvers,
}: {
  org: OrganizationInterface;
  teams: RoleSourceTeam[];
  model: RevisionModel;
  // Authority is required in all of them.
  projects: string[];
  footprint: ReviewAuthorityFootprint;
  approvers: { id: string; roleInfo: MemberRoleWithProjects | null }[];
}): { hasCoveringApproval: boolean; uncoveredApprovers: string[] } {
  const uncoveredApprovers: string[] = [];
  let hasCoveringApproval = false;

  for (const { id, roleInfo } of approvers) {
    const covers =
      !!roleInfo &&
      new Permissions(
        getRolePermissions(roleInfo, org, teams),
      ).canReviewRevision(model, projects, footprint);
    if (covers) hasCoveringApproval = true;
    else uncoveredApprovers.push(id);
  }

  return { hasCoveringApproval, uncoveredApprovers };
}
