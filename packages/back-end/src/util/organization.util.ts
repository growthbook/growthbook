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
    const newRoleIndex = roles.findIndex((r) => r.id === teamInfo.role);
    const existingRoleIndex = roles.findIndex((r) => r.id === existingRole);

    const existingRoleIsEngineerOrExperimenter =
      existingRole === "engineer" || existingRole === "experimenter";

    const newRoleIsEngineerOrExperimenter =
      teamInfo.role === "engineer" || teamInfo.role === "experimenter";

    // If the user's existing role is engineer or experimenter, and they're new role is engineer or experimenter
    // we have to do some special logic around environment specific permissions
    if (
      existingRoleIsEngineerOrExperimenter &&
      newRoleIsEngineerOrExperimenter
    ) {
      if (newRoleIndex === existingRoleIndex) {
        // If the new role and existing role's limitAccessByEnvironment values are the same, we concat the envs array
        // If they're different, that means one role isn't limitedByEnvironment, so we set the envs to an empty array
        existingPermissions.environments =
          existingPermissions.limitAccessByEnvironment ===
          teamInfo.limitAccessByEnvironment
            ? [
                ...new Set(
                  existingPermissions.environments.concat(teamInfo.environments)
                ),
              ]
            : [];

        // if the new role and existing role's limitAccessByEnvironment values are different, we set the existingPermissions.limitAccessByEnvironment to false
        // since one of the roles isn't limitedByEnvironment, otherwise, we keep it the same
        existingPermissions.limitAccessByEnvironment =
          existingPermissions.limitAccessByEnvironment !==
          teamInfo.limitAccessByEnvironment
            ? false
            : existingPermissions.limitAccessByEnvironment;
      }

      // If both roles have the same value for limitAccessByEnvironment, we just concat the envs arrays
      // No need to update the existingPermissions.limitAccessByEnvironment property since it's already set to the correct value
      // And if limitAccessByEnvironment is false, concating two empty arrays just returns an empty array
      if (
        existingPermissions.limitAccessByEnvironment ===
        teamInfo.limitAccessByEnvironment
      ) {
        existingPermissions.environments = [
          ...new Set(
            existingPermissions.environments.concat(teamInfo.environments)
          ),
        ];
      }
    }
    // Finally, we set the limitAccessByEnvironment and environments properties to the more permissive role's values.
    existingPermissions.limitAccessByEnvironment =
      newRoleIndex > existingRoleIndex
        ? teamInfo.limitAccessByEnvironment
        : existingPermissions.limitAccessByEnvironment;

    existingPermissions.environments =
      newRoleIndex > existingRoleIndex
        ? teamInfo.environments
        : existingPermissions.environments;
  }
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

  // If the member's global role is admin, they already have all permissions
  if (memberInfo?.role !== "admin" && memberInfo?.role) {
    const teamsUserIsOn = memberInfo?.teams || [];
    for (const team of teamsUserIsOn) {
      const teamData = await findTeamById(team, org.id);
      if (teamData) {
        mergePermissions(
          userPermissions.global,
          memberInfo.role,
          teamData,
          org
        );
        if (teamData?.projectRoles && teamData?.projectRoles.length > 0) {
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
