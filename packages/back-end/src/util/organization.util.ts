import { cloneDeep } from "lodash";
import { roleSupportsEnvLimit } from "shared/permissions";
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
  "readData",
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
  "manageVisualChanges",
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
  newPermissions: UserPermission,
  org: OrganizationInterface
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
      updatedPermissions.limitAccessByEnvironment = getLimitAccessByEnvironment(
        updatedPermissions.environments,
        updatedPermissions.limitAccessByEnvironment,
        org
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
        org
      );

      updatedPermissions.environments = newPermissions.environments;
    }
  }
  return updatedPermissions;
}

function mergeUserPermissionObj(
  userPermission1: UserPermission,
  userPermission2: UserPermission,
  org: OrganizationInterface
): UserPermission {
  let updatedUserPermissionObj = userPermission1;

  updatedUserPermissionObj = mergeEnvironmentLimits(
    updatedUserPermissionObj,
    userPermission2,
    org
  );
  updatedUserPermissionObj.permissions = mergePermissions(
    updatedUserPermissionObj.permissions,
    userPermission2.permissions
  );

  return updatedUserPermissionObj;
}

function mergeUserAndTeamPermissions(
  userPermissions: UserPermissions,
  teamPermissions: UserPermissions,
  org: OrganizationInterface
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
      },
      org
    );
  });

  // Merge the global permissions
  userPermissions.global = mergeUserPermissionObj(
    userPermissions.global,
    teamPermissions.global,
    org
  );
}

function getLimitAccessByEnvironment(
  environments: string[],
  limitAccessByEnvironment: boolean,
  org: OrganizationInterface
): boolean {
  // If all environments are selected, treat that the same as not limiting by environment
  const validEnvs = org.settings?.environments?.map((e) => e.id) || [];
  if (
    limitAccessByEnvironment &&
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
    role: MemberRole;
  },
  org: OrganizationInterface
): UserPermission {
  let limitAccessByEnvironment = !!info.limitAccessByEnvironment;

  // Only some roles can be limited by environment
  // TODO: This will have to change when we support custom roles
  if (limitAccessByEnvironment && !roleSupportsEnvLimit(info.role)) {
    limitAccessByEnvironment = false;
  }

  return {
    environments: info.environments || [],
    limitAccessByEnvironment: getLimitAccessByEnvironment(
      info.environments || [],
      limitAccessByEnvironment,
      org
    ),
    permissions: roleToPermissionMap(info.role, org),
  };
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
    global: getUserPermission(memberInfo, org),
    projects: {},
  };

  // Build the user-level project permissions
  memberInfo.projectRoles?.forEach((projectRole: ProjectMemberRole) => {
    userPermissions.projects[projectRole.project] = getUserPermission(
      projectRole,
      org
    );
  });

  // If the user is on a team, merge the team permissions into the user permissions
  if (memberInfo.teams) {
    for (const team of memberInfo.teams) {
      const teamData = teams.find((t) => t.id === team);
      if (teamData) {
        const teamPermissions: UserPermissions = {
          global: getUserPermission(teamData, org),
          projects: {},
        };
        if (teamData.projectRoles) {
          for (const teamProject of teamData.projectRoles) {
            teamPermissions.projects[teamProject.project] = getUserPermission(
              teamProject,
              org
            );
          }
        }
        mergeUserAndTeamPermissions(userPermissions, teamPermissions, org);
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
      id: "visualEditor",
      description: "Make visual changes for an experiment",
      permissions: ["readData", "manageVisualChanges"],
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
        "manageVisualChanges",
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
        "createSegments",
        "manageFactTables",
        "manageTags",
        "runQueries",
        "editDatasourceSettings",
        "manageVisualChanges",
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
        "manageVisualChanges",
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
