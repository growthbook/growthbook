import {
  getReadAccessFilter,
  hasReadAccess,
  Permissions,
} from "shared/permissions";
import {
  getUserPermissions,
  roleToPermissionMap,
} from "../src/util/organization.util";
import { OrganizationInterface } from "../types/organization";
import { TeamInterface } from "../types/team";
import { FeatureInterface } from "../types/feature";
import { MetricInterface } from "../types/metric";

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

  it("should build permissions for a basic noaccess user with no project-level permissions or teams correctly", async () => {
    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [{ ...testOrg.members[0], role: "noaccess" }],
      },
      []
    );
    expect(userPermissions).toEqual({
      global: {
        environments: [],
        limitAccessByEnvironment: false,
        permissions: roleToPermissionMap("noaccess", testOrg),
      },
      projects: {},
    });
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

describe("Build user's readAccessPermissions object", () => {
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

  it("user with global no access role should have no read access", async () => {
    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [{ ...testOrg.members[0], role: "noaccess" }],
      },
      []
    );

    const readAccessFilter = getReadAccessFilter(userPermissions);

    expect(readAccessFilter).toEqual({
      globalReadAccess: false,
      projects: [],
    });
  });

  it("user with global readonly role should have global read access", async () => {
    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [{ ...testOrg.members[0], role: "readonly" }],
      },
      []
    );

    const readAccessFilter = getReadAccessFilter(userPermissions);

    expect(readAccessFilter).toEqual({
      globalReadAccess: true,
      projects: [],
    });
  });

  it("user with global readonly role, and project noaccess should have global read access, but the project should have no read access", async () => {
    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [
          {
            ...testOrg.members[0],
            role: "readonly",
            projectRoles: [
              {
                project: "prj_exl5jr5dl4rbw856",
                role: "noaccess",
                limitAccessByEnvironment: true,
                environments: ["staging"],
              },
            ],
          },
        ],
      },
      []
    );

    const readAccessFilter = getReadAccessFilter(userPermissions);

    expect(readAccessFilter).toEqual({
      globalReadAccess: true,
      projects: [
        {
          id: "prj_exl5jr5dl4rbw856",
          readAccess: false,
        },
      ],
    });
  });

  it("user with global noaccess role, and project collaborator should not have global read access, but the project should have read access", async () => {
    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [
          {
            ...testOrg.members[0],
            role: "noaccess",
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

    const readAccessFilter = getReadAccessFilter(userPermissions);

    expect(readAccessFilter).toEqual({
      globalReadAccess: false,
      projects: [
        {
          id: "prj_exl5jr5dl4rbw856",
          readAccess: true,
        },
      ],
    });
  });

  it("should build the readAccessFilter correctly for a user with multiple project roles", async () => {
    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [
          {
            ...testOrg.members[0],
            role: "noaccess",
            projectRoles: [
              {
                project: "prj_exl5jr5dl4rbw856",
                role: "collaborator",
                limitAccessByEnvironment: true,
                environments: ["staging"],
              },
              {
                project: "prj_exl5jr5dl4rbw123",
                role: "engineer",
                limitAccessByEnvironment: true,
                environments: [],
              },
              {
                project: "prj_exl5jr5dl4rbw456",
                role: "engineer",
                limitAccessByEnvironment: true,
                environments: ["staging"],
              },
            ],
          },
        ],
      },
      []
    );

    const readAccessFilter = getReadAccessFilter(userPermissions);

    expect(readAccessFilter).toEqual({
      globalReadAccess: false,
      projects: [
        {
          id: "prj_exl5jr5dl4rbw856",
          readAccess: true,
        },
        {
          id: "prj_exl5jr5dl4rbw123",
          readAccess: true,
        },
        {
          id: "prj_exl5jr5dl4rbw456",
          readAccess: true,
        },
      ],
    });
  });
});

describe("hasReadAccess filter", () => {
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

  it("hasReadAccess should filter out all features for user with global no access role", async () => {
    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [{ ...testOrg.members[0], role: "noaccess" }],
      },
      []
    );

    const readAccessFilter = getReadAccessFilter(userPermissions);

    const features: Partial<FeatureInterface>[] = [
      {
        id: "test-feature-123",
        project: "",
      },
    ];

    const filteredFeatures = features.filter((feature) =>
      hasReadAccess(readAccessFilter, feature.project)
    );

    expect(filteredFeatures).toEqual([]);
  });

  it("hasReadAccess should not filter out all features for user with global readonly role", async () => {
    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [{ ...testOrg.members[0], role: "readonly" }],
      },
      []
    );

    const readAccessFilter = getReadAccessFilter(userPermissions);

    const features: Partial<FeatureInterface>[] = [
      {
        id: "test-feature-123",
        project: "",
      },
    ];

    const filteredFeatures = features.filter((feature) =>
      hasReadAccess(readAccessFilter, feature.project)
    );

    expect(filteredFeatures).toEqual([
      {
        id: "test-feature-123",
        project: "",
      },
    ]);
  });

  it("hasReadAccess should filter out all projects aside from the project the user has collaborator access to", async () => {
    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [
          {
            ...testOrg.members[0],
            role: "noaccess",
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

    const readAccessFilter = getReadAccessFilter(userPermissions);

    const features: Partial<FeatureInterface>[] = [
      {
        id: "test-feature-123",
        project: "",
      },
      {
        id: "test-feature-456",
        project: "prj_exl5jr5dl4rbw856",
      },
      {
        id: "test-feature-789",
        project: "prj_exl5jr5dl4rbw123",
      },
    ];

    const filteredFeatures = features.filter((feature) =>
      hasReadAccess(readAccessFilter, feature.project)
    );

    expect(filteredFeatures).toEqual([
      {
        id: "test-feature-456",
        project: "prj_exl5jr5dl4rbw856",
      },
    ]);
  });

  it("hasReadAccess should filter out all projects aside from the project the user has collaborator access to", async () => {
    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [
          {
            ...testOrg.members[0],
            role: "collaborator",
            projectRoles: [
              {
                project: "prj_exl5jr5dl4rbw856",
                role: "noaccess",
                limitAccessByEnvironment: true,
                environments: ["staging"],
              },
            ],
          },
        ],
      },
      []
    );

    const readAccessFilter = getReadAccessFilter(userPermissions);

    const features: Partial<FeatureInterface>[] = [
      {
        id: "test-feature-123",
        project: "",
      },
      {
        id: "test-feature-456",
        project: "prj_exl5jr5dl4rbw856",
      },
      {
        id: "test-feature-789",
        project: "prj_exl5jr5dl4rbw123",
      },
    ];

    const filteredFeatures = features.filter((feature) =>
      hasReadAccess(readAccessFilter, feature.project)
    );

    expect(filteredFeatures).toEqual([
      {
        id: "test-feature-123",
        project: "",
      },
      {
        id: "test-feature-789",
        project: "prj_exl5jr5dl4rbw123",
      },
    ]);
  });

  // e.g. user's global role is noaccess, but they have project-level permissions for a singular project - if their collaborator permissions include atleast 1 project on the metric, they should get access
  it("hasReadAccess should allow access if user has readAccess for atleast 1 project on an experiment", async () => {
    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [
          {
            ...testOrg.members[0],
            role: "noaccess",
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

    const readAccessFilter = getReadAccessFilter(userPermissions);

    const metrics: Partial<MetricInterface>[] = [
      {
        id: "test-feature-123",
        projects: [],
      },
      {
        id: "test-feature-456",
        projects: ["prj_exl5jr5dl4rbw856", "prj_exl5jr5dl4rbw123"],
      },
      {
        id: "test-feature-789",
        projects: ["prj_exl5jr5dl4rbw123"],
      },
    ];

    const filteredMetrics = metrics.filter((metric) =>
      hasReadAccess(readAccessFilter, metric.projects || [])
    );

    expect(filteredMetrics).toEqual([
      {
        id: "test-feature-123",
        projects: [],
      },
      {
        id: "test-feature-456",
        projects: ["prj_exl5jr5dl4rbw856", "prj_exl5jr5dl4rbw123"],
      },
    ]);
  });

  // The user's global role is collaborator, but they have project-level permissions for two projects that take away readaccess. If a metric is in both of the projects the user has noaccess role, AND a project the user doesn't have a specific permission for, the user should be able to access it due to their global permission
  it("hasReadAccess should not allow access if user has ", async () => {
    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [
          {
            ...testOrg.members[0],
            role: "collaborator",
            projectRoles: [
              {
                project: "prj_exl5jr5dl4rbw856",
                role: "noaccess",
                limitAccessByEnvironment: true,
                environments: ["staging"],
              },
              {
                project: "prj_exl5jr5dl4rbw123",
                role: "noaccess",
                limitAccessByEnvironment: true,
                environments: ["staging"],
              },
            ],
          },
        ],
      },
      []
    );

    const readAccessFilter = getReadAccessFilter(userPermissions);

    const metrics: Partial<MetricInterface>[] = [
      {
        id: "test-feature-123",
        projects: [],
      },
      {
        id: "test-feature-456",
        projects: ["prj_exl5jr5dl4rbw856", "prj_exl5jr5dl4rbw123", "abc123"],
      },
      {
        id: "test-feature-789",
        projects: ["prj_exl5jr5dl4rbw123"],
      },
    ];

    const filteredMetrics = metrics.filter((metric) =>
      hasReadAccess(readAccessFilter, metric.projects || [])
    );

    expect(filteredMetrics).toEqual([
      {
        id: "test-feature-123",
        projects: [],
      },
      {
        id: "test-feature-456",
        projects: ["prj_exl5jr5dl4rbw856", "prj_exl5jr5dl4rbw123", "abc123"],
      },
    ]);
  });

  // The user's global role is collaborator, but they have project-level permissions for two projects. If a metric is in both of the projects the user has a noaccess role for, the user shouldn't be able to access it
  it("hasReadAccess should not allow access if user has ", async () => {
    const userPermissions = getUserPermissions(
      "base_user_123",
      {
        ...testOrg,
        members: [
          {
            ...testOrg.members[0],
            role: "collaborator",
            projectRoles: [
              {
                project: "prj_exl5jr5dl4rbw856",
                role: "noaccess",
                limitAccessByEnvironment: true,
                environments: ["staging"],
              },
              {
                project: "prj_exl5jr5dl4rbw123",
                role: "noaccess",
                limitAccessByEnvironment: true,
                environments: ["staging"],
              },
            ],
          },
        ],
      },
      []
    );

    const readAccessFilter = getReadAccessFilter(userPermissions);

    const metrics: Partial<MetricInterface>[] = [
      {
        id: "test-feature-123",
        projects: [],
      },
      {
        id: "test-feature-456",
        projects: ["prj_exl5jr5dl4rbw856", "prj_exl5jr5dl4rbw123"],
      },
      {
        id: "test-feature-789",
        projects: ["prj_exl5jr5dl4rbw123"],
      },
    ];

    const filteredMetrics = metrics.filter((metric) =>
      hasReadAccess(readAccessFilter, metric.projects || [])
    );

    expect(filteredMetrics).toEqual([
      {
        id: "test-feature-123",
        projects: [],
      },
    ]);
  });
});

describe("PermissionsUtilClass.canCreateMetric check", () => {
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

  it("canCreateMetric should handle undefined projects correctly for engineer user", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("engineer", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      },
      false
    );

    expect(permissions.canCreateMetric({})).toEqual(false);
  });

  it("canCreateMetric should handle undefined projects correctly for experimenter user", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("experimenter", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      },
      false
    );

    expect(permissions.canCreateMetric({})).toEqual(true);
  });

  it("canCreateMetric should handle empty projects array correctly for noaccess user", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("noaccess", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      },
      false
    );

    expect(permissions.canCreateMetric({ projects: [] })).toEqual(false);
  });

  it("canCreateMetric should handle empty projects array correctly for experimenter user", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("experimenter", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      },
      false
    );

    expect(permissions.canCreateMetric({ projects: [] })).toEqual(true);
  });

  it("canCreateMetric should handle valid projects array correctly for noaccess user", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("noaccess", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      },
      false
    );

    expect(permissions.canCreateMetric({ projects: ["abc123"] })).toEqual(
      false
    );
  });

  it("canCreateMetric should handle valid projects array correctly for experimenter user", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("experimenter", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      },
      false
    );

    expect(permissions.canCreateMetric({ projects: ["abc123"] })).toEqual(true);
  });

  it("canCreateMetric should handle valid projects array correctly for experimenter user with project-level readonly role", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("experimenter", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {
          abc123: {
            permissions: roleToPermissionMap("readonly", testOrg),
            limitAccessByEnvironment: false,
            environments: [],
          },
        },
      },
      false
    );

    expect(permissions.canCreateMetric({ projects: ["abc123"] })).toEqual(
      false
    );
  });

  it("canCreateMetric should handle valid projects array correctly for readonly user with project-level experimenter role in only 1 of the two projects", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("readonly", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {
          abc123: {
            permissions: roleToPermissionMap("experimenter", testOrg),
            limitAccessByEnvironment: false,
            environments: [],
          },
        },
      },
      false
    );

    expect(
      // its false since the user doesn't have permission in all projects
      permissions.canCreateMetric({ projects: ["abc123", "def456"] })
    ).toEqual(false);
  });

  it("canCreateMetric should handle valid projects array correctly for readonly user with project-level experimenter and analyst roles", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("readonly", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {
          abc123: {
            permissions: roleToPermissionMap("experimenter", testOrg),
            limitAccessByEnvironment: false,
            environments: [],
          },
          def456: {
            permissions: roleToPermissionMap("analyst", testOrg),
            limitAccessByEnvironment: false,
            environments: [],
          },
        },
      },
      false
    );

    expect(
      // its true since the user DOES have permission in all projects
      permissions.canCreateMetric({ projects: ["abc123", "def456"] })
    ).toEqual(true);
  });
});

describe("PermissionsUtilClass.canUpdateMetric check", () => {
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

  it("canUpdateMetric should not allow updates if the user is an engineer (and doesn't have permission)", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("engineer", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      },
      false
    );

    const metric: Pick<MetricInterface, "projects" | "managedBy"> = {
      projects: ["abc123"],
      managedBy: "",
    };

    const updates: Pick<MetricInterface, "projects"> = {
      projects: ["abc123"],
    };

    expect(permissions.canUpdateMetric(metric, updates)).toEqual(false);
  });

  it("canUpdateMetric should allow updates if the metric projects are unchanged", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("experimenter", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      },
      false
    );

    const metric: Pick<MetricInterface, "projects" | "managedBy"> = {
      projects: ["abc123"],
      managedBy: "",
    };

    const updates: Pick<MetricInterface, "projects"> = {
      projects: ["abc123"],
    };

    expect(permissions.canUpdateMetric(metric, updates)).toEqual(true);
  });

  it("canUpdateMetric should allow updates if the updates don't change the projects", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("experimenter", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      },
      false
    );

    const metric: Pick<MetricInterface, "projects" | "managedBy"> = {
      projects: ["abc123"],
      managedBy: "",
    };

    const updates: Pick<MetricInterface, "projects"> = {};

    expect(permissions.canUpdateMetric(metric, updates)).toEqual(true);
  });

  it("canUpdateMetric should allow updates if the updates if the projects changed, but the user has permission in all of the projects", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("experimenter", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      },
      false
    );

    const metric: Pick<MetricInterface, "projects" | "managedBy"> = {
      projects: ["abc123"],
      managedBy: "",
    };

    const updates: Pick<MetricInterface, "projects"> = {
      projects: ["abc123", "def456"],
    };

    expect(permissions.canUpdateMetric(metric, updates)).toEqual(true);
  });

  it("canUpdateMetric should not allow updates if the projects changed, and the user does not have permission in all of the projects", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("experimenter", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {
          def456: {
            permissions: roleToPermissionMap("readonly", testOrg),
            limitAccessByEnvironment: false,
            environments: [],
          },
        },
      },
      false
    );

    const metric: Pick<MetricInterface, "projects" | "managedBy"> = {
      projects: ["abc123"],
      managedBy: "",
    };

    const updates: Pick<MetricInterface, "projects"> = {
      projects: ["abc123", "def456"],
    };

    expect(permissions.canUpdateMetric(metric, updates)).toEqual(false);
  });

  it("canUpdateMetric should handle user with global no-access role correctly", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("noaccess", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {
          def456: {
            permissions: roleToPermissionMap("experimenter", testOrg),
            limitAccessByEnvironment: false,
            environments: [],
          },
        },
      },
      false
    );

    const metric: Pick<MetricInterface, "projects" | "managedBy"> = {
      projects: ["def456"],
      managedBy: "",
    };

    const updates: Pick<MetricInterface, "projects"> = {
      projects: ["abc123", "def456"],
    };

    expect(permissions.canUpdateMetric(metric, updates)).toEqual(false);
  });

  it("canUpdateMetric should handle user with global no-access role correctly", async () => {
    console.log("starting last test");
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("noaccess", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {
          def456: {
            permissions: roleToPermissionMap("experimenter", testOrg),
            limitAccessByEnvironment: false,
            environments: [],
          },
        },
      },
      false
    );

    const metric: Pick<MetricInterface, "projects" | "managedBy"> = {
      projects: ["def456"],
      managedBy: "",
    };

    const updates: Pick<MetricInterface, "projects"> = {
      projects: [],
    };

    expect(permissions.canUpdateMetric(metric, updates)).toEqual(false);
  });
});

describe("PermissionsUtilClass.canDeleteMetric check", () => {
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

  it("canDeleteMetric should handle undefined projects correctly for engineer user", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("engineer", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      },
      false
    );

    expect(permissions.canDeleteMetric({})).toEqual(false);
  });

  it("canDeleteMetric should handle undefined projects correctly for experimenter user", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("experimenter", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      },
      false
    );

    expect(permissions.canDeleteMetric({})).toEqual(true);
  });

  it("canDeleteMetric should handle empty projects array correctly for noaccess user", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("noaccess", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      },
      false
    );

    expect(permissions.canDeleteMetric({ projects: [] })).toEqual(false);
  });

  it("canCreateMetric should handle empty projects array correctly for experimenter user", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("experimenter", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      },
      false
    );

    expect(permissions.canCreateMetric({ projects: [] })).toEqual(true);
  });

  it("canCreateMetric should handle valid projects array correctly for noaccess user", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("noaccess", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      },
      false
    );

    expect(permissions.canCreateMetric({ projects: ["abc123"] })).toEqual(
      false
    );
  });

  it("canCreateMetric should handle valid projects array correctly for experimenter user", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("experimenter", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      },
      false
    );

    expect(permissions.canCreateMetric({ projects: ["abc123"] })).toEqual(true);
  });

  it("canCreateMetric should handle valid projects array correctly for experimenter user with project-level readonly role", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("experimenter", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {
          abc123: {
            permissions: roleToPermissionMap("readonly", testOrg),
            limitAccessByEnvironment: false,
            environments: [],
          },
        },
      },
      false
    );

    expect(permissions.canCreateMetric({ projects: ["abc123"] })).toEqual(
      false
    );
  });

  it("canCreateMetric should handle valid projects array correctly for readonly user with project-level experimenter role in only 1 of the two projects", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("readonly", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {
          abc123: {
            permissions: roleToPermissionMap("experimenter", testOrg),
            limitAccessByEnvironment: false,
            environments: [],
          },
        },
      },
      false
    );

    expect(
      // its false since the user doesn't have permission in all projects
      permissions.canCreateMetric({ projects: ["abc123", "def456"] })
    ).toEqual(false);
  });

  it("canCreateMetric should handle valid projects array correctly for readonly user with project-level experimenter and analyst roles", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("readonly", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {
          abc123: {
            permissions: roleToPermissionMap("experimenter", testOrg),
            limitAccessByEnvironment: false,
            environments: [],
          },
          def456: {
            permissions: roleToPermissionMap("analyst", testOrg),
            limitAccessByEnvironment: false,
            environments: [],
          },
        },
      },
      false
    );

    expect(
      // its true since the user DOES have permission in all projects
      permissions.canCreateMetric({ projects: ["abc123", "def456"] })
    ).toEqual(true);
  });
});

describe("PermissionsUtilClass.canAddComment check", () => {
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
  it("canAddComment returns true for user with global experimenter role on experiment in 'All Projects'", () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("experimenter", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      },
      false
    );

    expect(permissions.canAddComment([])).toEqual(true);
  });
  it("canAddComment returns true for user with global experimenter role on experiment in 'abc123'", () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("experimenter", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      },
      false
    );

    expect(permissions.canAddComment(["abc123"])).toEqual(true);
  });
  it("canAddComment returns false for user with global readonly role on experiment in 'All Projects'", () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("readonly", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      },
      false
    );

    expect(permissions.canAddComment([])).toEqual(false);
  });
  it("canAddComment returns false for user with global noaccess role on experiment in 'abc123'", () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("noaccess", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      },
      false
    );

    expect(permissions.canAddComment(["abc123"])).toEqual(false);
  });
  it("canAddComment returns true for user with global noaccess role and experimenter role for project 'abc123' for an experiment in 'abc123'", () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("noaccess", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {
          abc123: {
            permissions: roleToPermissionMap("experimenter", testOrg),
            limitAccessByEnvironment: false,
            environments: [],
          },
        },
      },
      false
    );

    expect(permissions.canAddComment(["abc123"])).toEqual(true);
  });
  it("canAddComment returns false for user with global noaccess role and project-level experimenter role, but checking for a different project", () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("noaccess", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {
          abc123: {
            permissions: roleToPermissionMap("experimenter", testOrg),
            limitAccessByEnvironment: false,
            environments: [],
          },
        },
      },
      false
    );

    expect(permissions.canAddComment(["def123"])).toEqual(false);
  });
  it("canAddComment returns true for user with global noaccess role and project-level experimenter role for metric in multiple projects, including the project they have permission for", () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("noaccess", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {
          abc123: {
            permissions: roleToPermissionMap("experimenter", testOrg),
            limitAccessByEnvironment: false,
            environments: [],
          },
        },
      },
      false
    );

    expect(permissions.canAddComment(["abc123", "def123", "hij123"])).toEqual(
      true
    );
  });
  it("canAddComment returns false for user with global noaccess role on experiment in 'def123'", () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("noaccess", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {
          abc123: {
            permissions: roleToPermissionMap("readonly", testOrg),
            limitAccessByEnvironment: false,
            environments: [],
          },
        },
      },
      false
    );

    expect(permissions.canAddComment(["abc123", "def123", "hij123"])).toEqual(
      false
    );
  });
  // This is a test specific to the putUpload endpoint - the user needs to have addComment permission either globally, or in atleast 1 project in order to be able to upload images
  it("canAddComment returns true for user with global noaccess role and 1 project level experimenter role", () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("noaccess", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {
          abc123: {
            permissions: roleToPermissionMap("experimenter", testOrg),
            limitAccessByEnvironment: false,
            environments: [],
          },
        },
      },
      false
    );

    expect(permissions.canAddComment([])).toEqual(true);
  });
});

describe("PermissionsUtilClass.canByPassApprovalChecks", () => {
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

  it("User with experimenter role unable to bypassApprovalCheck", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("experimenter", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      },
      false
    );

    expect(permissions.canBypassApprovalChecks({ project: "" })).toEqual(false);
  });

  it("User with admin role able to bypassApprovalCheck", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("admin", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      },
      false
    );

    expect(permissions.canBypassApprovalChecks({ project: "" })).toEqual(true);
  });
});

describe("PermissionsUtilClass.canReviewFeatureDrafts", () => {
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

  it("User with experimenter role able to reviewFeatureDrafts", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("experimenter", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      },
      false
    );

    expect(permissions.canReviewFeatureDrafts({ project: "" })).toEqual(true);
  });

  it("User with engineer role able to reviewFeatureDrafts", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("engineer", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      },
      false
    );

    expect(permissions.canReviewFeatureDrafts({ project: "" })).toEqual(true);
  });

  it("User with anaylst role able to reviewFeatureDrafts", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("analyst", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      },
      false
    );

    expect(permissions.canReviewFeatureDrafts({ project: "" })).toEqual(false);
  });

  it("User with global readonly role, but experimenter role on project 'abc123', should be able to reivew features in project 'abc123'", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("readonly", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {
          abc123: {
            permissions: roleToPermissionMap("experimenter", testOrg),
            limitAccessByEnvironment: false,
            environments: [],
          },
        },
      },
      false
    );

    expect(permissions.canReviewFeatureDrafts({ project: "abc123" })).toEqual(
      true
    );
  });

  it("User with global experimenter role, but readonly role on project 'abc123', should be able to reivew features in project 'abc123'", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("experimenter", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {
          abc123: {
            permissions: roleToPermissionMap("readonly", testOrg),
            limitAccessByEnvironment: false,
            environments: [],
          },
        },
      },
      false
    );

    expect(permissions.canReviewFeatureDrafts({ project: "abc123" })).toEqual(
      false
    );
  });

  it("User with admin role able to bypassApprovalCheck", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("admin", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      },
      false
    );

    expect(permissions.canReviewFeatureDrafts({ project: "" })).toEqual(true);
  });
});

describe("PermissionsUtilClass.canManageFeatureDrafts", () => {
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

  it("User with collaborator role is not able to manage feature drafts", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("collaborator", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      },
      false
    );

    expect(permissions.canManageFeatureDrafts({ project: "" })).toEqual(false);
  });

  it("User with engineer role is able to manage feature drafts", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("engineer", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      },
      false
    );

    expect(permissions.canManageFeatureDrafts({ project: "" })).toEqual(true);
  });

  it("User with anaylst role is not able to manage feature drafts", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("analyst", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      },
      false
    );

    expect(permissions.canManageFeatureDrafts({ project: "" })).toEqual(false);
  });

  it("User with global readonly role is not able to manage feature drafts for feature without a project", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("readonly", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {
          abc123: {
            permissions: roleToPermissionMap("engineer", testOrg),
            limitAccessByEnvironment: false,
            environments: [],
          },
        },
      },
      false
    );

    expect(permissions.canManageFeatureDrafts({ project: "" })).toEqual(false);
  });

  it("User with global readonly role is able to manage feature drafts if their project specific permissions grant it", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("readonly", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {
          abc123: {
            permissions: roleToPermissionMap("engineer", testOrg),
            limitAccessByEnvironment: false,
            environments: [],
          },
        },
      },
      false
    );

    expect(permissions.canManageFeatureDrafts({ project: "abc123" })).toEqual(
      true
    );
  });

  it("canManageFeatureDrafts works as expected for a feature without the project property", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("engineer", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {
          abc123: {
            permissions: roleToPermissionMap("collaborator", testOrg),
            limitAccessByEnvironment: false,
            environments: [],
          },
        },
      },
      false
    );

    expect(permissions.canManageFeatureDrafts({})).toEqual(true);
  });

  it("canManageFeatureDrafts works as expected for a feature without the project property", async () => {
    const permissions = new Permissions(
      {
        global: {
          permissions: roleToPermissionMap("collaborator", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {
          abc123: {
            permissions: roleToPermissionMap("engineer", testOrg),
            limitAccessByEnvironment: false,
            environments: [],
          },
        },
      },
      false
    );

    expect(permissions.canManageFeatureDrafts({})).toEqual(false);
  });
});
