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

// Only the role-bearing fields, so callers holding a team without its member
// list (the front end) can resolve permissions too.
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

  // Loop through that list of projects and merge the user and team permissions.
  // An explicitly-set project role takes precedence over a global role, so a
  // principal with no project role contributes nothing (not its global role)
  // rather than letting its global permissions leak into the project.
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
  // If all environments are selected, treat that the same as not limiting by
  // environment. `every` on an empty list is vacuously true, so an org whose
  // settings carry no environments would otherwise read as "all selected" and
  // drop the restriction entirely — keep it when there is nothing to compare
  // against.
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
    // The env verdict for scoped permissions comes from per-role grants, so two
    // roles with different restrictions can't cross-contaminate when merged.
    // Omitted (not []) when the role grants nothing env-scoped, so the object
    // keeps its historical shape for roles the field says nothing about.
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

/**
 * Build a full UserPermissions object from a role info with optional project
 * roles and team memberships. Used for both org API keys and member records.
 */
export function getRolePermissions(
  roleInfo: MemberRoleWithProjects,
  org: OrganizationInterface,
  allTeams: RoleSourceTeam[],
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

  return permissions;
}

/**
 * The teams a member belongs to, resolved for display and for policy that keys on
 * team rather than on identity. Shared so a custom hook's reviewer props and any
 * future required-approver-team gate agree on what "in team X" means.
 *
 * Returns [] for a non-member and for API-key reviewers, which belong to no team.
 */
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

/**
 * Which standing approvals still count, judged against what the draft changes.
 *
 * Takes each approver's role rules rather than looking them up, so the same
 * function serves the server (from org.members) and the client (from the
 * members map). A null roleInfo means they are no longer a member, and a
 * non-member covers nothing.
 *
 * Uses CURRENT rules — an approval is not a snapshot of authority. Losing
 * rights in an environment the draft now touches withdraws coverage.
 */
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
  /**
   * Which entity is being approved. Required, not defaulted: each model declares
   * its own review atom and scope, and judging one entity by another's atom is
   * correct only by coincidence of how the policies happen to bundle today.
   */
  model: RevisionModel;
  /** Every project the entity belongs to — authority is required in all of them. */
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
