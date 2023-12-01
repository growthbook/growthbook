import {
  getUserPermissions,
  roleToPermissionMap,
} from "../src/util/organization.util";
import { OrganizationInterface } from "../types/organization";
import { TeamInterface } from "../types/team";

describe("Build base user permissions", () => {
  const testOrg: OrganizationInterface = {
    id: "org_sktwi1id9l7z9xkjb",
    name: "Test Org",
    ownerEmail: "test@test.com",
    url: "https://test.com",
    dateCreated: new Date(),
    invites: [],
    members: [
      {
        id: "base_user_123",
        role: "readonly",
        dateCreated: new Date(),
        limitAccessByEnvironment: false,
        environments: [],
        projectRoles: [],
        teams: [],
      },
    ],
    settings: {
      environments: [
        { id: "development" },
        { id: "staging" },
        { id: "production" },
      ],
    },
  };
  // Basic user permissions - no project-level permissions or teams
  it("should throw error if user isn't in the org", async () => {
    expect(async () =>
      getUserPermissions("base_user_not_in_org", testOrg, [])
    ).rejects.toThrow("User is not a member of this organization");
  });

  it("should build permissions for a basic readonly user with no project-level permissions or teams correctly", async () => {
    const userPermissions = getUserPermissions("base_user_123", testOrg, []);
    expect(userPermissions).toEqual({
      global: {
        environments: [],
        limitAccessByEnvironment: false,
        permissions: roleToPermissionMap("readonly", testOrg),
      },
      projects: {},
    });
  });

  it("should build permissions for a basic collaborator user with no project-level permissions or teams correctly", async () => {
    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [{ ...testOrg.members[0], role: "collaborator" }],
      },
      []
    );
    expect(userPermissions).toEqual({
      global: {
        environments: [],
        limitAccessByEnvironment: false,
        permissions: roleToPermissionMap("collaborator", testOrg),
      },
      projects: {},
    });
  });

  it("should build permissions for a basic engineer user with no project-level permissions or teams correctly", async () => {
    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [{ ...testOrg.members[0], role: "engineer" }],
      },
      []
    );
    expect(userPermissions).toEqual({
      global: {
        environments: [],
        limitAccessByEnvironment: false,
        permissions: roleToPermissionMap("engineer", testOrg),
      },
      projects: {},
    });
  });

  it("should build permissions for a basic analyst user with no project-level permissions or teams correctly", async () => {
    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [{ ...testOrg.members[0], role: "analyst" }],
      },
      []
    );
    expect(userPermissions).toEqual({
      global: {
        environments: [],
        limitAccessByEnvironment: false,
        permissions: roleToPermissionMap("analyst", testOrg),
      },
      projects: {},
    });
  });

  it("should build permissions for a basic experimenter user with no project-level permissions or teams correctly", async () => {
    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [{ ...testOrg.members[0], role: "experimenter" }],
      },
      []
    );
    expect(userPermissions).toEqual({
      global: {
        environments: [],
        limitAccessByEnvironment: false,
        permissions: roleToPermissionMap("experimenter", testOrg),
      },
      projects: {},
    });
  });

  it("should build permissions for an admin user with no project-level permissions or teams correctly", async () => {
    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [{ ...testOrg.members[0], role: "admin" }],
      },
      []
    );
    expect(userPermissions).toEqual({
      global: {
        environments: [],
        limitAccessByEnvironment: false,
        permissions: roleToPermissionMap("admin", testOrg),
      },
      projects: {},
    });
  });

  it("should ignore limitAccessByEnvironment for roles that don't apply", async () => {
    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [
          {
            ...testOrg.members[0],
            role: "admin",
            limitAccessByEnvironment: true,
            environments: ["development"],
            projectRoles: [
              {
                project: "prj_exl5jr5dl4rbw856",
                role: "collaborator",
                limitAccessByEnvironment: true,
                environments: ["staging"],
              },
            ],
          },
        ],
      },
      []
    );
    expect(userPermissions).toEqual({
      global: {
        environments: ["development"],
        limitAccessByEnvironment: false,
        permissions: roleToPermissionMap("admin", testOrg),
      },
      projects: {
        prj_exl5jr5dl4rbw856: {
          environments: ["staging"],
          limitAccessByEnvironment: false,
          permissions: roleToPermissionMap("collaborator", testOrg),
        },
      },
    });
  });

  it("detects when all environments are selected", async () => {
    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [
          {
            ...testOrg.members[0],
            role: "engineer",
            limitAccessByEnvironment: true,
            environments: ["staging", "development", "production"],
          },
        ],
      },
      []
    );
    expect(userPermissions).toEqual({
      global: {
        environments: ["staging", "development", "production"],
        limitAccessByEnvironment: false,
        permissions: roleToPermissionMap("engineer", testOrg),
      },
      projects: {},
    });
  });

  it("ignores unknown environments", async () => {
    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [
          {
            ...testOrg.members[0],
            role: "engineer",
            limitAccessByEnvironment: true,
            environments: ["staging", "production", "unknown"],
          },
        ],
      },
      []
    );
    expect(userPermissions).toEqual({
      global: {
        environments: ["staging", "production", "unknown"],
        limitAccessByEnvironment: true,
        permissions: roleToPermissionMap("engineer", testOrg),
      },
      projects: {},
    });
  });

  // Slightly advanced user permissions - project-level permissions, but no teams
  it("should build permissions for a readonly user with a single engineer project-level permission and no teams correctly", async () => {
    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [
          {
            ...testOrg.members[0],
            projectRoles: [
              {
                project: "prj_exl5jr5dl4rbw856",
                role: "engineer",
                limitAccessByEnvironment: false,
                environments: [],
              },
            ],
          },
        ],
      },
      []
    );

    expect(userPermissions).toEqual({
      global: {
        environments: [],
        limitAccessByEnvironment: false,
        permissions: roleToPermissionMap("readonly", testOrg),
      },
      projects: {
        prj_exl5jr5dl4rbw856: {
          environments: [],
          limitAccessByEnvironment: false,
          permissions: roleToPermissionMap("engineer", testOrg),
        },
      },
    });
  });

  it("should build permissions for a readonly user with  multiple project-level permissions and no teams correctly", async () => {
    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [
          {
            ...testOrg.members[0],
            projectRoles: [
              {
                project: "prj_exl5jr5dl4rbw856",
                role: "engineer",
                limitAccessByEnvironment: false,
                environments: [],
              },
              {
                project: "prj_exl5jr5dl4rbw123",
                role: "analyst",
                limitAccessByEnvironment: false,
                environments: [],
              },
            ],
          },
        ],
      },
      []
    );

    expect(userPermissions).toEqual({
      global: {
        environments: [],
        limitAccessByEnvironment: false,
        permissions: roleToPermissionMap("readonly", testOrg),
      },
      projects: {
        prj_exl5jr5dl4rbw856: {
          environments: [],
          limitAccessByEnvironment: false,
          permissions: roleToPermissionMap("engineer", testOrg),
        },
        prj_exl5jr5dl4rbw123: {
          environments: [],
          limitAccessByEnvironment: false,
          permissions: roleToPermissionMap("analyst", testOrg),
        },
      },
    });
  });

  it("should build permissions for an engineer user with environment specific permissions correctly", async () => {
    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [
          {
            ...testOrg.members[0],
            role: "engineer",
            environments: ["staging", "development"],
            limitAccessByEnvironment: true,
          },
        ],
      },
      []
    );

    expect(userPermissions).toEqual({
      global: {
        environments: ["staging", "development"],
        limitAccessByEnvironment: true,
        permissions: roleToPermissionMap("engineer", testOrg),
      },
      projects: {},
    });
  });

  it("should build permissions for an engineer user with environment specific permissions and project-level roles that have environment specific permissions correctly", async () => {
    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [
          {
            ...testOrg.members[0],
            role: "engineer",
            limitAccessByEnvironment: true,
            environments: ["staging", "development"],
            projectRoles: [
              {
                project: "prj_exl5jr5dl4rbw856",
                role: "engineer",
                limitAccessByEnvironment: true,
                environments: ["production"],
              },
              {
                project: "prj_exl5jr5dl4rbw123",
                role: "analyst",
                limitAccessByEnvironment: false,
                environments: [],
              },
            ],
          },
        ],
      },
      []
    );

    expect(userPermissions).toEqual({
      global: {
        environments: ["staging", "development"],
        limitAccessByEnvironment: true,
        permissions: roleToPermissionMap("engineer", testOrg),
      },
      projects: {
        prj_exl5jr5dl4rbw856: {
          environments: ["production"],
          limitAccessByEnvironment: true,
          permissions: roleToPermissionMap("engineer", testOrg),
        },
        prj_exl5jr5dl4rbw123: {
          environments: [],
          limitAccessByEnvironment: false,
          permissions: roleToPermissionMap("analyst", testOrg),
        },
      },
    });
  });
  // Advanced user permissions - global role, project-level permissions, and user is on team(s)
  it("should build permissions for a readonly user with no environment specific permissions and project-level roles that have environment specific permissions correctly where the user is on a team that has collaborator permissions", async () => {
    const teams: TeamInterface[] = [
      {
        id: "team_123",
        name: "Team Collaborators",
        organization: "org_id_1234",
        description: "",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        createdBy: "Demo User",
        role: "collaborator",
        limitAccessByEnvironment: false,
        environments: [],
        projectRoles: [],
        managedByIdp: false,
      },
    ];

    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [
          {
            ...testOrg.members[0],
            projectRoles: [
              {
                project: "prj_exl5jr5dl4rbw856",
                role: "engineer",
                limitAccessByEnvironment: true,
                environments: ["production"],
              },
              {
                project: "prj_exl5jr5dl4rbw123",
                role: "analyst",
                limitAccessByEnvironment: false,
                environments: [],
              },
            ],
            teams: ["team_123"],
          },
        ],
      },
      teams
    );

    expect(userPermissions).toEqual({
      global: {
        environments: [],
        limitAccessByEnvironment: false,
        permissions: roleToPermissionMap("collaborator", testOrg),
      },
      projects: {
        prj_exl5jr5dl4rbw856: {
          environments: ["production"],
          limitAccessByEnvironment: true,
          permissions: roleToPermissionMap("engineer", testOrg),
        },
        prj_exl5jr5dl4rbw123: {
          environments: [],
          limitAccessByEnvironment: false,
          permissions: roleToPermissionMap("analyst", testOrg),
        },
      },
    });
  });

  it("should not override a user's global permissions with a team's permissions if the user has a more permissive role (e.g. don't override admin permissions with collaborator permissions", async () => {
    const teams: TeamInterface[] = [
      {
        id: "team_123",
        name: "Team Collaborators",
        organization: "org_id_1234",
        description: "",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        createdBy: "Demo User",
        role: "collaborator",
        limitAccessByEnvironment: false,
        environments: [],
        projectRoles: [],
        managedByIdp: false,
      },
    ];

    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [
          {
            ...testOrg.members[0],
            teams: ["team_123"],
            role: "admin",
          },
        ],
      },
      teams
    );

    expect(userPermissions).toEqual({
      global: {
        environments: [],
        limitAccessByEnvironment: false,
        permissions: roleToPermissionMap("admin", testOrg),
      },
      projects: {},
    });
  });

  it("should build permissions for a basic engineer user with no environment specific permissions and project-level roles that have environment specific permissions correctly where the user is on a team that has engineer permissions", async () => {
    const teams: TeamInterface[] = [
      {
        id: "team_123",
        name: "Team Engineers",
        organization: "org_id_1234",
        description: "",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        createdBy: "Demo User",
        role: "engineer",
        limitAccessByEnvironment: true,
        environments: ["staging"],
        projectRoles: [],
        managedByIdp: false,
      },
    ];

    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [
          {
            ...testOrg.members[0],
            role: "engineer",
            limitAccessByEnvironment: true,
            environments: ["production"],
            projectRoles: [],
            teams: ["team_123"],
          },
        ],
      },
      teams
    );

    expect(userPermissions).toEqual({
      global: {
        environments: ["production", "staging"],
        limitAccessByEnvironment: true,
        permissions: roleToPermissionMap("engineer", testOrg),
      },
      projects: {},
    });
  });

  it("disables limitAccessByEnvironment when all environments are included after merging team permissions", async () => {
    const teams: TeamInterface[] = [
      {
        id: "team_123",
        name: "Team Engineers",
        organization: "org_id_1234",
        description: "",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        createdBy: "Demo User",
        role: "engineer",
        limitAccessByEnvironment: true,
        environments: ["staging", "development"],
        projectRoles: [],
        managedByIdp: false,
      },
    ];

    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [
          {
            ...testOrg.members[0],
            role: "engineer",
            limitAccessByEnvironment: true,
            environments: ["production"],
            projectRoles: [],
            teams: ["team_123"],
          },
        ],
      },
      teams
    );

    expect(userPermissions).toEqual({
      global: {
        environments: ["production", "staging", "development"],
        limitAccessByEnvironment: false,
        permissions: roleToPermissionMap("engineer", testOrg),
      },
      projects: {},
    });
  });

  it("should build permissions for a readonly user that has project specific engineer permissions, with specific environment permissions,and is on a team that also has engineering permissions, but no environment limits", async () => {
    const teams: TeamInterface[] = [
      {
        id: "team_123",
        name: "Test Team",
        organization: "org_id_1234",
        description: "",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        createdBy: "Demo User",
        role: "readonly",
        limitAccessByEnvironment: false,
        environments: [],
        projectRoles: [
          {
            project: "prj_exl5jr5dl4rbw856",
            role: "engineer",
            limitAccessByEnvironment: false,
            environments: [],
          },
        ],
        managedByIdp: false,
      },
    ];

    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [
          {
            ...testOrg.members[0],
            projectRoles: [
              {
                project: "prj_exl5jr5dl4rbw856",
                role: "engineer",
                limitAccessByEnvironment: true,
                environments: ["staging"],
              },
            ],
            teams: ["team_123"],
          },
        ],
      },
      teams
    );

    expect(userPermissions).toEqual({
      global: {
        environments: [],
        limitAccessByEnvironment: false,
        permissions: roleToPermissionMap("readonly", testOrg),
      },
      projects: {
        prj_exl5jr5dl4rbw856: {
          environments: [],
          limitAccessByEnvironment: false,
          permissions: roleToPermissionMap("engineer", testOrg),
        },
      },
    });
  });

  it("should ignore limitAccessByEnvironment in teams with roles that don't support that", async () => {
    const teams: TeamInterface[] = [
      {
        id: "team_123",
        name: "Test Team",
        organization: "org_id_1234",
        description: "",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        createdBy: "Demo User",
        role: "admin",
        limitAccessByEnvironment: true,
        environments: ["development"],
        projectRoles: [
          {
            project: "prj_test",
            role: "collaborator",
            limitAccessByEnvironment: true,
            environments: ["staging"],
          },
          {
            project: "prj_exl5jr5dl4rbw856",
            role: "collaborator",
            limitAccessByEnvironment: true,
            environments: ["staging"],
          },
        ],
        managedByIdp: false,
      },
    ];

    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [
          {
            ...testOrg.members[0],
            projectRoles: [
              {
                project: "prj_exl5jr5dl4rbw856",
                role: "engineer",
                limitAccessByEnvironment: true,
                environments: ["production"],
              },
            ],
            teams: ["team_123"],
          },
        ],
      },
      teams
    );

    expect(userPermissions).toEqual({
      global: {
        environments: ["development"],
        limitAccessByEnvironment: false,
        permissions: roleToPermissionMap("admin", testOrg),
      },
      projects: {
        prj_test: {
          environments: [],
          limitAccessByEnvironment: false,
          permissions: roleToPermissionMap("collaborator", testOrg),
        },
        prj_exl5jr5dl4rbw856: {
          environments: ["production"],
          limitAccessByEnvironment: true,
          permissions: roleToPermissionMap("engineer", testOrg),
        },
      },
    });
  });

  it("should update global permissions if team role is more permissive than user global role", async () => {
    const teams: TeamInterface[] = [
      {
        id: "team_123",
        name: "Test Team",
        organization: "org_id_1234",
        description: "",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        createdBy: "Demo User",
        role: "engineer",
        limitAccessByEnvironment: true,
        environments: ["staging", "production"],
        projectRoles: [],
        managedByIdp: false,
      },
    ];

    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [
          {
            ...testOrg.members[0],
            role: "collaborator",
            teams: ["team_123"],
          },
        ],
      },
      teams
    );

    expect(userPermissions).toEqual({
      global: {
        environments: ["staging", "production"],
        limitAccessByEnvironment: true,
        permissions: roleToPermissionMap("engineer", testOrg),
      },
      projects: {},
    });
  });

  it("should not override a user's global permissions env level permissions with a team's permissions if the user has a more permissive role", async () => {
    const teams: TeamInterface[] = [
      {
        id: "team_123",
        name: "Test Team",
        organization: "org_id_1234",
        description: "",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        createdBy: "Demo User",
        role: "engineer",
        limitAccessByEnvironment: true,
        environments: ["staging", "production"],
        projectRoles: [],
        managedByIdp: false,
      },
    ];

    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [
          {
            ...testOrg.members[0],
            teams: ["team_123"],
            role: "admin",
          },
        ],
      },
      teams
    );

    expect(userPermissions).toEqual({
      global: {
        environments: [],
        limitAccessByEnvironment: false,
        permissions: roleToPermissionMap("admin", testOrg),
      },
      projects: {},
    });
  });

  it("should not overwrite experimenter permissions with engineer permissions", async () => {
    const teams: TeamInterface[] = [
      {
        id: "team_123",
        name: "Test Team",
        organization: "org_id_1234",
        description: "",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        createdBy: "Demo User",
        role: "engineer",
        limitAccessByEnvironment: true,
        environments: ["staging", "production"],
        projectRoles: [],
        managedByIdp: false,
      },
    ];

    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [
          {
            ...testOrg.members[0],
            role: "experimenter",
            teams: ["team_123"],
          },
        ],
      },
      teams
    );

    expect(userPermissions).toEqual({
      global: {
        environments: [],
        limitAccessByEnvironment: false,
        permissions: roleToPermissionMap("experimenter", testOrg),
      },
      projects: {},
    });
  });

  it("should correctly merge engineer and experimenters env specific limits", async () => {
    const teams: TeamInterface[] = [
      {
        id: "team_123",
        name: "Test Team",
        organization: "org_id_1234",
        description: "",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        createdBy: "Demo User",
        role: "experimenter",
        limitAccessByEnvironment: true,
        environments: ["staging"],
        projectRoles: [],
        managedByIdp: false,
      },
    ];

    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [
          {
            ...testOrg.members[0],
            role: "engineer",
            limitAccessByEnvironment: true,
            environments: ["production"],
            teams: ["team_123"],
          },
        ],
      },
      teams
    );

    expect(userPermissions).toEqual({
      global: {
        environments: ["production", "staging"],
        limitAccessByEnvironment: true,
        permissions: roleToPermissionMap("experimenter", testOrg),
      },
      projects: {},
    });
  });

  it("shouldn't override a global engineer's env specific limits if they're on a team that gives them analyst permissions", async () => {
    const teams: TeamInterface[] = [
      {
        id: "team_123",
        name: "Test Team",
        organization: "org_id_1234",
        description: "",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        createdBy: "Demo User",
        role: "readonly",
        limitAccessByEnvironment: false,
        environments: [],
        projectRoles: [
          {
            project: "prj_exl5jr5dl4rbw856",
            role: "analyst",
            limitAccessByEnvironment: false,
            environments: [],
          },
        ],
        managedByIdp: false,
      },
    ];

    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [
          {
            ...testOrg.members[0],
            projectRoles: [
              {
                project: "prj_exl5jr5dl4rbw856",
                role: "engineer",
                limitAccessByEnvironment: true,
                environments: ["development"],
              },
            ],
            teams: ["team_123"],
          },
        ],
      },
      teams
    );

    expect(userPermissions).toEqual({
      global: {
        environments: [],
        limitAccessByEnvironment: false,
        permissions: roleToPermissionMap("readonly", testOrg),
      },
      projects: {
        prj_exl5jr5dl4rbw856: {
          environments: ["development"],
          limitAccessByEnvironment: true,
          permissions: roleToPermissionMap("experimenter", testOrg),
        },
      },
    });
  });

  it("should add project level permissions if the user's global role doesn't give any access, but the user is on a team that inherits project-level permissions", async () => {
    const teams: TeamInterface[] = [
      {
        id: "team_123",
        name: "Test Team",
        organization: "org_id_1234",
        description: "",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        createdBy: "Demo User",
        role: "readonly",
        limitAccessByEnvironment: false,
        environments: [],
        projectRoles: [
          {
            project: "prj_exl5jr5dl4rbw856",
            role: "analyst",
            limitAccessByEnvironment: false,
            environments: [],
          },
        ],
        managedByIdp: false,
      },
    ];

    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [
          {
            ...testOrg.members[0],
            projectRoles: [],
            teams: ["team_123"],
          },
        ],
      },
      teams
    );

    expect(userPermissions).toEqual({
      global: {
        environments: [],
        limitAccessByEnvironment: false,
        permissions: roleToPermissionMap("readonly", testOrg),
      },
      projects: {
        prj_exl5jr5dl4rbw856: {
          environments: [],
          limitAccessByEnvironment: false,
          permissions: roleToPermissionMap("analyst", testOrg),
        },
      },
    });
  });

  it("should correctly override a project-specific role if the team's project specific role is higher", async () => {
    const teams: TeamInterface[] = [
      {
        id: "team_123",
        name: "Test Team",
        organization: "org_id_1234",
        description: "",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        createdBy: "Demo User",
        role: "experimenter",
        limitAccessByEnvironment: true,
        environments: ["staging", "development"],
        projectRoles: [
          {
            project: "prj_exl5jr5dl4rbw856",
            role: "engineer",
            limitAccessByEnvironment: false,
            environments: [],
          },
        ],
        managedByIdp: false,
      },
    ];

    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [
          {
            ...testOrg.members[0],
            projectRoles: [
              {
                project: "prj_exl5jr5dl4rbw856",
                role: "collaborator",
                limitAccessByEnvironment: false,
                environments: [],
              },
            ],
            teams: ["team_123"],
          },
        ],
      },
      teams
    );

    expect(userPermissions).toEqual({
      global: {
        environments: ["staging", "development"],
        limitAccessByEnvironment: true,
        permissions: roleToPermissionMap("experimenter", testOrg),
      },
      projects: {
        prj_exl5jr5dl4rbw856: {
          environments: [],
          limitAccessByEnvironment: false,
          permissions: roleToPermissionMap("engineer", testOrg),
        },
      },
    });
  });

  it("should correctly merge environment limits for a user's project-level role and a team's project-level role", async () => {
    const teams: TeamInterface[] = [
      {
        id: "team_123",
        name: "Test Team",
        organization: "org_id_1234",
        description: "",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        createdBy: "Demo User",
        role: "experimenter",
        limitAccessByEnvironment: true,
        environments: ["staging", "development"],
        projectRoles: [
          {
            project: "prj_exl5jr5dl4rbw856",
            role: "engineer",
            limitAccessByEnvironment: true,
            environments: ["production"],
          },
        ],
        managedByIdp: false,
      },
    ];

    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [
          {
            ...testOrg.members[0],
            projectRoles: [
              {
                project: "prj_exl5jr5dl4rbw856",
                role: "engineer",
                limitAccessByEnvironment: true,
                environments: ["development"],
              },
            ],
            teams: ["team_123"],
          },
        ],
      },
      teams
    );

    expect(userPermissions).toEqual({
      global: {
        environments: ["staging", "development"],
        limitAccessByEnvironment: true,
        permissions: roleToPermissionMap("experimenter", testOrg),
      },
      projects: {
        prj_exl5jr5dl4rbw856: {
          environments: ["development", "production"],
          limitAccessByEnvironment: true,
          permissions: roleToPermissionMap("engineer", testOrg),
        },
      },
    });
  });

  it("should correctly merge user with global read-only, who is on a team where the global role is engineer, and has a project-specific role of readonly.", async () => {
    const teams: TeamInterface[] = [
      {
        id: "team_123",
        name: "Test Team",
        organization: "org_id_1234",
        description: "",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        createdBy: "Demo User",
        role: "engineer",
        limitAccessByEnvironment: false,
        environments: [],
        projectRoles: [
          {
            project: "prj_exl5jr5dl4rbw856",
            role: "readonly",
            limitAccessByEnvironment: false,
            environments: [],
          },
        ],
        managedByIdp: false,
      },
    ];

    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [
          {
            ...testOrg.members[0],
            projectRoles: [],
            teams: ["team_123"],
          },
        ],
      },
      teams
    );

    expect(userPermissions).toEqual({
      global: {
        environments: [],
        limitAccessByEnvironment: false,
        permissions: roleToPermissionMap("engineer", testOrg),
      },
      projects: {
        prj_exl5jr5dl4rbw856: {
          environments: [],
          limitAccessByEnvironment: false,
          permissions: roleToPermissionMap("readonly", testOrg),
        },
      },
    });
  });
});
