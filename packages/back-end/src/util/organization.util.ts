import {
  MemberRole,
  MemberRoleInfo,
  OrganizationInterface,
  Permission,
  Role,
} from "../../types/organization";

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

export function getPermissionsByRole(
  role: MemberRole,
  org: OrganizationInterface
): Permission[] {
  const roles = getRoles(org);
  const orgRole = roles.find((r) => r.id === role);
  const permissions = new Set<Permission>(orgRole?.permissions || []);
  return Array.from(permissions);
}

export function getUserPermissionsAll(user: any, org: OrganizationInterface) {
  const roles = getRoles(org);
  const actionsUserCanPerform = roles.find((r) => r.id === user.role);
  console.log("actionsUserCanPerform", actionsUserCanPerform);
  const permissions: any = {};
  ALL_PERMISSIONS.forEach((permission) => {
    const obj = {
      globalPermissions: {
        hasPermission:
          user.role && actionsUserCanPerform?.permissions.includes(permission)
            ? true
            : false,
        limitAccessByEnvironment: user.role.limitAccessByEnvironment || false,
        environments: user.role.environments || [],
      },
      // Now, if this user has projectRoles, we need to loop through them, and see if they have a role for this permission
      // We also need to check to see if the projectRole limits access by environment
      // projectPermissions: [],
      projectPermissions: !user.projectRoles.length
        ? []
        : user.projectRoles.map((projectRole: any) => {
            const actionsUserCanPerformPerProject = roles.find(
              (r) => r.id === projectRole.role
            );
            return {
              hasPermission: actionsUserCanPerformPerProject?.permissions.includes(
                permission
              ),
              projectId: projectRole.project,
              limitAccessByEnvironment: projectRole.limitAccessByEnvironment,
              environments: projectRole.environments || [],
            };
          }),
    };
    permissions[permission] = obj;
  });
  return permissions;
}

export function getUserPermissions(user: any, org: OrganizationInterface) {
  console.log("made it to the getUserPermissions function");
  console.log("user passed in to getUserPermissions: ", user);
  // This function takes in a user and an organization and returns a Set of permissions
  // A user can have a user role
  // A user can also have project specific roles
  // A user can also be on multiple teams, and each team has a global role, as well as project specific roles
  // Additionally, there are env specific roles that can be applied to a user
  // Ideally, this method will return ONLY the list of actions the user has permissions to perform, e.g. we won't pass down
  // the entire list of permissions with a true/false value, but rather just the list of permissions the user has access to
  // This way, we can then just check if the action in question is in the user's "permissions" object/Set.
  // Unknowns - how we add env specific roles to a user
  // First, we need to look and see if the user has a user role, if so, get all permissions associated with that role and add them to the Set
  // Then, we need to look at if the user has projectRoles, and if so, loop through all of those

  const roles = getRoles(org);

  // const permissions = new Set<{
  //   [key: string]: boolean;
  //   limitAccessByEnvironment: boolean;
  //   environments: any[];
  //   projects: any[];
  // }>();
  const permissions: any = {};

  // Do the user's global role (if they have one, first)
  if (user.role) {
    const actionsUserCanPerform = roles.find((r) => r.id === user.role);
    console.log("actionsUserCanPerform", actionsUserCanPerform);

    console.log("user", user);

    const projectPermissions: any[] = [];

    actionsUserCanPerform?.permissions.forEach((permission) => {
      const obj = {
        globalPermissions: {
          hasPermission: true,
          limitAccessByEnvironment: user.role.limitAccessByEnvironment || false,
          environments: user.role.environments || [],
        },
        // projectPermissions: [],
        projectPermissions:
          user.projectRoles && !user.projectRoles.length
            ? []
            : user.role.projectRoles.map((projectRole: any) => {
                console.log("projectRole", projectRole);
                // const role = roles.find((r) => r.id === projectRole.role);
                // console.log("role", role);
                return {
                  projectId: projectRole.project,
                };
              }),
      };
      // I need to loop through each project
      // Determine the status of the [permission] for this role in this project

      console.log("obj", obj);
      permissions[permission] = obj;
    });
  }
  return permissions;
}
// We'd then loop through the teams project specific permissions and do the same logic
// Check if the projectId existed within the projectPermissions array, if not, add it, along with the permissions
// If it did exist, compare the two and see if the team's permissions were more permissive, if so, overwrite
// If it exists and the permissions are the same, then we need to check if the team's permissions are limited by env, and if so, merge the environments
// If the team's permissions are limited by env, and the user's aren't, then we set limitedByEnv to false

//  permissions: {
//   createAnalyses: {
//     globalPermissions: {
//       hasPermission: true,
//       limitedByEnv: true,
//       environments: ["staging"]
//     }
//     projectPermissions: [
//       {
//         projectId: "projectId1",
//         hasPermission: true,
//         limitedByEnv: true,
//         environments: ["production"]
//       },
//       {
//         projectId: "projectId2",
//         hasPermission: true,
//         limitedByEnv: true,
//         environments: ["development"]
//       },
//       {
//         projectId: "projectId3",
//         hasPermission: false,
//         limitedByEnv: false,
//         environments: []
//       }
//     ]
//   }
//  }

export function getPermissionsByTeamAndRole(
  rolesArr: any[],
  org: OrganizationInterface
) {
  const roles = getRoles(org);
  console.log("roles", roles);
  console.log("rolesArr", rolesArr);
  const permissions: any = {};
  rolesArr.forEach((index) => {
    const role = roles.find((r) => r.id === index.globalRole);
    const globalPermissions: any = {};
    role?.permissions.forEach((permission) => {
      globalPermissions[permission] = true;
    });
    const projectPermissions: any[] = [];
    // Now I need to loop through each project and add the project permissions
    if (index.projectRoles.length > 0) {
      index.projectRoles.forEach((projectRole: any) => {
        const role = roles.find((r) => r.id === projectRole.role);
        const permissionsObj: any = {};
        role?.permissions.forEach((permission) => {
          permissionsObj[permission] = true;
        });
        projectPermissions.push({
          project: projectRole.project,
          permissions: permissionsObj,
          //TODO: I need to add logic here around environments
        });
        // What do I need to do here?
      });
    }
    permissions[index.type] = { globalPermissions, projectPermissions };
  });
  return permissions;
}

// export function getUserPermissions() {
//   return {
//     globalPermissions
//   }
// }

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
