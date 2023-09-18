import { roleSupportsEnvLimit } from "shared/permissions";
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
  existingPermissions: UserPermission,
  existingRole: MemberRole | undefined,
  teamInfo: TeamInterface | ProjectMemberRole,
  org: OrganizationInterface
) {
  const newPermissions = roleToPermissionMap(teamInfo.role, org);
  for (const newPermission in newPermissions) {
    // If the user doesn't have permission, but the team role does, add it
    if (
      !existingPermissions.permissions[newPermission as Permission] &&
      newPermissions[newPermission as Permission]
    ) {
      existingPermissions.permissions[newPermission as Permission] =
        newPermissions[newPermission as Permission];
    }
  }

  if (!existingRole) {
    existingPermissions.limitAccessByEnvironment =
      teamInfo.limitAccessByEnvironment;
    existingPermissions.environments = teamInfo.environments;
  } else {
    const roles = getRoles(org);

    const newRoleAccessLevel =
      roles.find((role) => role.id === teamInfo.role)?.accessLevel || 0;
    const existingRoleAccessLevel =
      roles.find((role) => role.id === existingRole)?.accessLevel || 0;

    if (
      // If the existingRole & newRole can be limited by environment
      roleSupportsEnvLimit(existingRole) &&
      roleSupportsEnvLimit(teamInfo.role)
    ) {
      if (
        // and if limitAccessByEnvironment is the same for new and existing roles, we just concat the envs arrays
        existingPermissions.limitAccessByEnvironment ===
        teamInfo.limitAccessByEnvironment
      ) {
        existingPermissions.environments = [
          ...new Set(
            existingPermissions.environments.concat(teamInfo.environments)
          ),
        ];
      } else {
        // otherwise, 1 role doesn't have limited access by environment, so it overrides the other
        existingPermissions.limitAccessByEnvironment = false;
        existingPermissions.environments = [];
      }
    } else {
      // Finally, we set the limitAccessByEnvironment and environments properties to the more permissive role's values.
      existingPermissions.limitAccessByEnvironment =
        newRoleAccessLevel > existingRoleAccessLevel
          ? teamInfo.limitAccessByEnvironment
          : existingPermissions.limitAccessByEnvironment;

      existingPermissions.environments =
        newRoleAccessLevel > existingRoleAccessLevel
          ? teamInfo.environments
          : existingPermissions.environments;
    }
  }
}

async function mergeUserAndTeamPermissions(
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
      mergePermissions(userPermissions.global, memberInfo.role, teamData, org);
      if (teamData?.projectRoles) {
        for (const teamProject of teamData.projectRoles) {
          const existingProjectData = memberInfo.projectRoles?.find(
            (project) => project.project === teamProject.project
          );
          mergePermissions(
            userPermissions.projects[teamProject.project],
            existingProjectData?.role,
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

  await mergeUserAndTeamPermissions(memberInfo, userPermissions, org);

  return userPermissions;
}

export function getRoles(_organization: OrganizationInterface): Role[] {
  // TODO: support custom roles?
  return [
    {
      id: "readonly",
      description: "View all features and experiment results",
      permissions: [],
      accessLevel: 0,
    },
    {
      id: "collaborator",
      description: "Add comments and contribute ideas",
      permissions: ["addComments", "createIdeas", "createPresentations"],
      accessLevel: 1,
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
      accessLevel: 2,
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
      accessLevel: 3,
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
      accessLevel: 4,
    },
    {
      id: "admin",
      description:
        "All access + invite teammates and configure organization settings",
      permissions: [...ALL_PERMISSIONS],
      accessLevel: 5,
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
