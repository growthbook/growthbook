import { cloneDeep } from "lodash";
import {
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

function mergePermissions(
  existingPermissions: PermissionsObject,
  newPermissions: PermissionsObject
): PermissionsObject {
  const newPermissionsObj = cloneDeep(existingPermissions);

  for (const permission in newPermissions) {
    if (
      !newPermissionsObj[permission as Permission] &&
      newPermissions[permission as Permission]
    ) {
      newPermissionsObj[permission as Permission] =
        newPermissions[permission as Permission];
    }
  }

  return newPermissionsObj;
}

function mergeEnvAccess(
  existingPermissions: UserPermission,
  newPermissions: UserPermission
): UserPermission {
  const permissionsObj = cloneDeep(existingPermissions);

  const existingRoleSupportsEnvLimits = roleSupportsEnvLimit(
    existingPermissions.permissions
  );
  const newRoleSupportsEnvLimits = roleSupportsEnvLimit(
    newPermissions.permissions
  );

  if (!existingRoleSupportsEnvLimits && !newRoleSupportsEnvLimits) {
    // Neither role supports env limits, so we can skip logic below
    return permissionsObj;
  }

  if (
    // If the existingRole & newRole can be limited by environment
    existingRoleSupportsEnvLimits &&
    newRoleSupportsEnvLimits
  ) {
    if (
      // and if limitAccessByEnvironment is the same for new and existing roles, we just concat the envs arrays
      permissionsObj.limitAccessByEnvironment ===
      newPermissions.limitAccessByEnvironment
    ) {
      permissionsObj.environments = [
        ...new Set(
          permissionsObj.environments.concat(newPermissions.environments)
        ),
      ];
    } else {
      // otherwise, 1 role doesn't have limited access by environment, so it overrides the other
      permissionsObj.limitAccessByEnvironment = false;
      permissionsObj.environments = [];
    }
  } else {
    // Only override existing role's env limits if the existing role doesn't support env limits, and the newRole does
    if (!existingRoleSupportsEnvLimits && newRoleSupportsEnvLimits) {
      permissionsObj.limitAccessByEnvironment =
        newPermissions.limitAccessByEnvironment;

      permissionsObj.environments = newPermissions.environments;
    }
  }
  return permissionsObj;
}

function combineRoles(items: UserPermission[]): UserPermission {
  let permissionsObj = items[0];

  permissionsObj = mergeEnvAccess(items[0], items[1]);

  for (let i = 1; i < items.length; i++) {
    permissionsObj.permissions = mergePermissions(
      permissionsObj.permissions,
      items[i].permissions
    );
  }

  return permissionsObj;
}

function mergeUserPermissions(
  userPermissions: UserPermissions,
  teamPermissions: UserPermissions
) {
  userPermissions.global = combineRoles([
    userPermissions.global,
    teamPermissions.global,
  ]);

  for (const project in teamPermissions.projects) {
    // If the userPermissions.projects doesn't have this project, just add it
    if (!userPermissions.projects[project]) {
      userPermissions.projects[project] = teamPermissions.projects[project];
    } else {
      // Otherwise, merge the permissions
      userPermissions.projects[project] = combineRoles([
        userPermissions.projects[project],
        teamPermissions.projects[project],
      ]);
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

  // If the user is on a team, merge the team permissions into the user permissions
  if (memberInfo.teams) {
    for (const team of memberInfo.teams) {
      const teamData = await findTeamById(team, org.id);
      if (teamData) {
        const teamPermissions: UserPermissions = {
          global: {
            environments: teamData.environments,
            limitAccessByEnvironment: teamData.limitAccessByEnvironment,
            permissions: roleToPermissionMap(teamData.role, org),
          },
          projects: {},
        };
        if (teamData.projectRoles) {
          for (const teamProject of teamData.projectRoles) {
            teamPermissions.projects[teamProject.project] = {
              limitAccessByEnvironment: teamProject.limitAccessByEnvironment,
              environments: teamProject.environments,
              permissions: roleToPermissionMap(teamProject.role, org),
            };
          }
        }
        // now that I have the team's UserPermissions object, combine it with the user's UserPermissions object
        mergeUserPermissions(userPermissions, teamPermissions);
      }
    }
  }

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
