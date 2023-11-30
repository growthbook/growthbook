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
import { TeamInterface } from "../../types/team";

export const ENV_SCOPED_PERMISSIONS = [
  "publishFeatures",
  "manageEnvironments",
  "runExperiments",
] as const;

export const PROJECT_SCOPED_PERMISSIONS = [
  "readData", //TODO: I currently have this in both PROJECT_SCOPED & GLOBAL - this is the only one that lives in both - is that weird?
  "addComments",
  "createFeatureDrafts",
  "manageFeatures",
  "manageProjects",
  "createAnalyses",
  "createIdeas",
  "createMetrics",
  "manageFactTables",
  "createDatasources",
  "editDatasourceSettings",
  "runQueries",
] as const;

export const GLOBAL_PERMISSIONS = [
  "readData",
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
  "manageArchetype",
  "viewEvents",
] as const;

export const ALL_PERMISSIONS = [
  ...GLOBAL_PERMISSIONS,
  ...PROJECT_SCOPED_PERMISSIONS,
  ...ENV_SCOPED_PERMISSIONS,
];

function hasEnvScopedPermissions(userPermission: PermissionsObject): boolean {
  const envLimitedPermissions: Permission[] = ENV_SCOPED_PERMISSIONS.map(
    (permission) => permission
  );

  for (const permission of envLimitedPermissions) {
    if (userPermission[permission]) {
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

function isValidPermission(permission: string): permission is Permission {
  return ALL_PERMISSIONS.includes(permission as Permission);
}

function mergePermissions(
  existingPermissions: PermissionsObject,
  newPermissions: PermissionsObject
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
  newPermissions: UserPermission
): UserPermission {
  const existingRoleSupportsEnvLimits = hasEnvScopedPermissions(
    existingPermissions.permissions
  );
  const newRoleSupportsEnvLimits = hasEnvScopedPermissions(
    newPermissions.permissions
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
          updatedPermissions.environments.concat(newPermissions.environments)
        ),
      ];
    } else {
      // otherwise, 1 role doesn't have limited access by environment, so it overrides the other
      updatedPermissions.limitAccessByEnvironment = false;
      updatedPermissions.environments = [];
    }
  } else {
    // Only override existing role's env limits if the existing role doesn't support env limits, and the newRole does
    if (!existingRoleSupportsEnvLimits && newRoleSupportsEnvLimits) {
      updatedPermissions.limitAccessByEnvironment =
        newPermissions.limitAccessByEnvironment;

      updatedPermissions.environments = newPermissions.environments;
    }
  }
  return updatedPermissions;
}

function mergeUserPermissionObj(
  userPermission1: UserPermission,
  userPermission2: UserPermission
): UserPermission {
  let updatedUserPermissionObj = userPermission1;

  updatedUserPermissionObj = mergeEnvironmentLimits(
    updatedUserPermissionObj,
    userPermission2
  );
  updatedUserPermissionObj.permissions = mergePermissions(
    updatedUserPermissionObj.permissions,
    userPermission2.permissions
  );

  return updatedUserPermissionObj;
}

function mergeUserAndTeamPermissions(
  userPermissions: UserPermissions,
  teamPermissions: UserPermissions
) {
  // Build a list of all projects
  const allProjects = new Set([
    ...Object.keys(userPermissions.projects),
    ...Object.keys(teamPermissions.projects),
  ]);

  // Loop through that list of projects and merge the user and team permissions
  allProjects.forEach((project) => {
    userPermissions.projects[project] = mergeUserPermissionObj(
      userPermissions.projects[project] || {
        limitAccessByEnvironment:
          userPermissions.global.limitAccessByEnvironment,
        environments: userPermissions.global.environments,
        permissions: userPermissions.global.permissions,
      },
      teamPermissions.projects[project] || {
        limitAccessByEnvironment:
          teamPermissions.global.limitAccessByEnvironment,
        environments: teamPermissions.global.environments,
        permissions: teamPermissions.global.permissions,
      }
    );
  });

  // Merge the global permissions
  userPermissions.global = mergeUserPermissionObj(
    userPermissions.global,
    teamPermissions.global
  );
}

export function getUserPermissions(
  userId: string,
  org: OrganizationInterface,
  teams: TeamInterface[]
): UserPermissions {
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
      const teamData = teams.find((t) => t.id === team);
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
        mergeUserAndTeamPermissions(userPermissions, teamPermissions);
      }
    }
  }

  return userPermissions;
}

export function getRoles(_organization: OrganizationInterface): Role[] {
  // TODO: support custom roles?
  return [
    {
      id: "noaccess",
      description:
        "Cannot view any features or experiments. Most useful when combined with project-scoped roles.",
      permissions: [],
    },
    {
      id: "readonly",
      description: "View all features and experiment results",
      permissions: ["readData"],
    },
    {
      id: "collaborator",
      description: "Add comments and contribute ideas",
      permissions: [
        "readData",
        "addComments",
        "createIdeas",
        "createPresentations",
      ],
    },
    {
      id: "engineer",
      description: "Manage features",
      permissions: [
        "readData",
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
        "manageArchetype",
        "runExperiments",
      ],
    },
    {
      id: "analyst",
      description: "Analyze experiments",
      permissions: [
        "readData",
        "addComments",
        "createIdeas",
        "createPresentations",
        "createAnalyses",
        "createDimensions",
        "createMetrics",
        "manageFactTables",
        "manageTags",
        "runQueries",
        "editDatasourceSettings",
      ],
    },
    {
      id: "experimenter",
      description: "Manage features AND Analyze experiments",
      permissions: [
        "readData",
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
        "manageArchetype",
        "manageTags",
        "runExperiments",
        "createAnalyses",
        "createDimensions",
        "createSegments",
        "createMetrics",
        "manageFactTables",
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
