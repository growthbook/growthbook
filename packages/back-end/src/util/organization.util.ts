import {
  MemberRole,
  MemberRoleInfo,
  OrganizationInterface,
  Permission,
  PermissionsObject,
  ProjectMemberRole,
  Role,
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

export async function getUserPermissions(
  userId: string,
  org: OrganizationInterface
): Promise<UserPermissions> {
  const memberInfo = org.members.find((m) => m.id === userId);
  const userPermissions: UserPermissions = {
    global: {
      environments: memberInfo?.environments || [],
      limitAccessByEnvironment: memberInfo?.limitAccessByEnvironment || false,
      permissions: roleToPermissionMap(memberInfo?.role, org),
    },
    projects: {},
  };

  // Build the user's user-level project permissions
  memberInfo?.projectRoles?.forEach((projectRole: ProjectMemberRole) => {
    userPermissions.projects[projectRole.project] = {
      limitAccessByEnvironment: projectRole.limitAccessByEnvironment || false,
      environments: projectRole.environments || [],
      permissions: roleToPermissionMap(projectRole.role, org),
    };
  });

  console.log("memberInfo", memberInfo);

  // If the user's global role is admin, we can skip the team checks as they already have full permissions
  if (memberInfo?.role !== "admin") {
    //TODO: Figure out how I can abstract this into a function to reuse it for the project level permission logic
    const teamsUserIsOn = memberInfo?.teams || [];
    for (const team of teamsUserIsOn) {
      const teamData = await findTeamById(team, org.id);
      console.log("teamData", teamData);
      if (teamData) {
        const teamGlobalPermissions = roleToPermissionMap(teamData.role, org);
        for (const permission in teamGlobalPermissions) {
          // If the user doesn't have permission globally, and but the role they have via a team does, override the user-level global permission
          if (
            !userPermissions.global.permissions[permission as Permission] &&
            teamGlobalPermissions[permission as Permission]
          ) {
            userPermissions.global.permissions[permission as Permission] =
              teamGlobalPermissions[permission as Permission];
          }
        }
        // How do we handle a user where they're global role is 'collaborator' so they have no env level restrictions
        // but they're on a team that DOES have env level restrictions? In that case, we have to set their global role limitAccessByEnv to that of the team
        if (
          teamData.role === "engineer" ||
          (teamData.role === "experimenter" &&
            teamData.limitAccessByEnvironment)
        ) {
          userPermissions.global.limitAccessByEnvironment = true;
          userPermissions.global.environments = userPermissions.global.environments.concat(
            teamData.environments
          );
        }
        if (teamData.role === "admin") {
          userPermissions.global.limitAccessByEnvironment = false;
          userPermissions.global.environments = [];
        }
      }
    }
  }

  // Build the user's project-level permissions

  // Loop through each team, and then loop through each pro

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
