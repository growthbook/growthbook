import { cloneDeep } from "lodash";
import {
  Member,
  MemberRole,
  MemberRoleInfo,
  OrganizationInterface,
  Permission,
  PermissionsObject,
  ProjectMemberRole,
  Role,
  UserPermission,
  UserPermissions,
} from "../../types/organization";
import { TeamInterface } from "../../types/team";
import { findTeamById } from "../models/TeamModel";

export const ENV_SCOPED_PERMISSIONS = [
  "publishFeatures",
  "manageEnvironments",
  "runExperiments",
] as const;

export const PROJECT_SCOPED_PERMISSIONS = [
  "addComments",
  "createFeatureDrafts",
  "manageFeatures",
  "manageProjects",
  "createAnalyses",
  "createIdeas",
  "createMetrics",
  "createDatasources",
  "editDatasourceSettings",
  "runQueries",
] as const;

export const GLOBAL_PERMISSIONS = [
  "createPresentations",
  "createDimensions",
  "createSegments",
  "organizationSettings",
  "superDelete",
  "manageTeam",
  "manageTags",
  "manageApiKeys",
  "manageIntegrations",
  "manageWebhooks",
  "manageBilling",
  "manageNorthStarMetric",
  "manageTargetingAttributes",
  "manageNamespaces",
  "manageSavedGroups",
  "viewEvents",
] as const;

export const ALL_PERMISSIONS = [
  ...GLOBAL_PERMISSIONS,
  ...PROJECT_SCOPED_PERMISSIONS,
  ...ENV_SCOPED_PERMISSIONS,
];

function roleSupportsEnvLimit(userPermission: PermissionsObject): boolean {
  const envLimitedPermissions: string[] = ENV_SCOPED_PERMISSIONS.map(
    (permission) => permission
  );

  for (const permission of envLimitedPermissions) {
    if (userPermission[permission as Permission]) {
      return true;
    }
  }
  return false;
}

export function roleToPermissionMap(
  role: MemberRole | undefined,
  org: OrganizationInterface
): PermissionsObject {
  const roles = getRoles(org);
  const orgRole = roles.find((r) => r.id === role);
  const permissions = new Set<Permission>(orgRole?.permissions || []);

  const permissionsObj: PermissionsObject = {};
  ALL_PERMISSIONS.forEach((p) => {
    permissionsObj[p] = permissions.has(p);
  });
  return permissionsObj;
}

function combineRoles(
  existingPermissions: UserPermission,
  teamInfo: TeamInterface | ProjectMemberRole,
  org: OrganizationInterface
): UserPermission {
  const newPermissions = roleToPermissionMap(teamInfo.role, org);

  if (!existingPermissions) {
    return {
      environments: teamInfo.environments,
      limitAccessByEnvironment: teamInfo.limitAccessByEnvironment,
      permissions: newPermissions,
    };
  }

  const existingPermissionsCopy = cloneDeep(existingPermissions);

  for (const newPermission in newPermissions) {
    if (
      !existingPermissionsCopy.permissions[newPermission as Permission] &&
      newPermissions[newPermission as Permission]
    ) {
      existingPermissionsCopy.permissions[newPermission as Permission] =
        newPermissions[newPermission as Permission];
    }
  }

  const existingRoleSupportsEnvLimits = roleSupportsEnvLimit(
    existingPermissions.permissions
  );

  const newRoleSupportsEnvLimits = roleSupportsEnvLimit(newPermissions);

  if (
    // If the existingRole & newRole can be limited by environment
    existingRoleSupportsEnvLimits &&
    newRoleSupportsEnvLimits
  ) {
    if (
      // and if limitAccessByEnvironment is the same for new and existing roles, we just concat the envs arrays
      existingPermissionsCopy.limitAccessByEnvironment ===
      teamInfo.limitAccessByEnvironment
    ) {
      existingPermissionsCopy.environments = [
        ...new Set(
          existingPermissionsCopy.environments.concat(teamInfo.environments)
        ),
      ];
    } else {
      // otherwise, 1 role doesn't have limited access by environment, so it overrides the other
      existingPermissionsCopy.limitAccessByEnvironment = false;
      existingPermissionsCopy.environments = [];
    }
  } else {
    // Otherwise, 1 role can be limitedByEnvironment, and the other cant - e.g. engineer vs analyst
    if (existingRoleSupportsEnvLimits && !newRoleSupportsEnvLimits) {
      existingPermissionsCopy.limitAccessByEnvironment =
        existingPermissions.limitAccessByEnvironment;
      existingPermissionsCopy.environments = existingPermissions.environments;
    }
    // If the old role can't be limited by environment, and the new role can, set the old role's permissions to the new role's permissions
    if (!existingRoleSupportsEnvLimits && newRoleSupportsEnvLimits) {
      existingPermissionsCopy.limitAccessByEnvironment =
        teamInfo.limitAccessByEnvironment;

      existingPermissionsCopy.environments = teamInfo.environments;
    }
  }
  return existingPermissionsCopy;
}

async function mergeUserPermissions(
  memberInfo: Member,
  userPermissions: UserPermissions,
  org: OrganizationInterface
) {
  if (!memberInfo.teams) {
    return;
  }

  for (const team of memberInfo.teams) {
    const teamData = await findTeamById(team, org.id);
    if (teamData) {
      userPermissions.global = combineRoles(
        userPermissions.global,
        teamData,
        org
      );
      if (teamData?.projectRoles) {
        for (const teamProject of teamData.projectRoles) {
          userPermissions.projects[teamProject.project] = combineRoles(
            userPermissions.projects[teamProject.project],
            teamProject,
            org
          );
        }
      }
    }
  }
}

export async function getUserPermissions(
  userId: string,
  org: OrganizationInterface
): Promise<UserPermissions> {
  const memberInfo = org.members.find((m) => m.id === userId);

  if (!memberInfo) {
    throw new Error("User is not a member of this organization");
  }
  const userPermissions: UserPermissions = {
    global: {
      environments: memberInfo.environments,
      limitAccessByEnvironment: memberInfo.limitAccessByEnvironment,
      permissions: roleToPermissionMap(memberInfo.role, org),
    },
    projects: {},
  };

  // Build the user-level project permissions
  memberInfo.projectRoles?.forEach((projectRole: ProjectMemberRole) => {
    userPermissions.projects[projectRole.project] = {
      limitAccessByEnvironment: projectRole.limitAccessByEnvironment,
      environments: projectRole.environments,
      permissions: roleToPermissionMap(projectRole.role, org),
    };
  });

  await mergeUserPermissions(memberInfo, userPermissions, org);

  return userPermissions;
}

export function getRoles(_organization: OrganizationInterface): Role[] {
  // TODO: support custom roles?
  return [
    {
      id: "readonly",
      description: "View all features and experiment results",
      permissions: [],
    },
    {
      id: "collaborator",
      description: "Add comments and contribute ideas",
      permissions: ["addComments", "createIdeas", "createPresentations"],
    },
    {
      id: "engineer",
      description: "Manage features",
      permissions: [
        "addComments",
        "createIdeas",
        "createPresentations",
        "publishFeatures",
        "manageFeatures",
        "manageTags",
        "createFeatureDrafts",
        "manageTargetingAttributes",
        "manageEnvironments",
        "manageNamespaces",
        "manageSavedGroups",
        "runExperiments",
      ],
    },
    {
      id: "analyst",
      description: "Analyze experiments",
      permissions: [
        "addComments",
        "createIdeas",
        "createPresentations",
        "createAnalyses",
        "createDimensions",
        "createMetrics",
        "manageTags",
        "runQueries",
        "editDatasourceSettings",
      ],
    },
    {
      id: "experimenter",
      description: "Manage features AND Analyze experiments",
      permissions: [
        "addComments",
        "createIdeas",
        "createPresentations",
        "publishFeatures",
        "manageFeatures",
        "createFeatureDrafts",
        "manageTargetingAttributes",
        "manageEnvironments",
        "manageNamespaces",
        "manageSavedGroups",
        "manageTags",
        "runExperiments",
        "createAnalyses",
        "createDimensions",
        "createSegments",
        "createMetrics",
        "runQueries",
        "editDatasourceSettings",
      ],
    },
    {
      id: "admin",
      description:
        "All access + invite teammates and configure organization settings",
      permissions: [...ALL_PERMISSIONS],
    },
  ];
}

export function getDefaultRole(
  organization: OrganizationInterface
): MemberRoleInfo {
  return (
    organization.settings?.defaultRole || {
      environments: [],
      limitAccessByEnvironment: false,
      role: "collaborator",
    }
  );
}
