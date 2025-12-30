import { Permissions, roleToPermissionMap } from "shared/permissions";
import { OrganizationInterface } from "shared/types/organization";
import { TeamInterface } from "shared/types/team";
import { FeatureInterface } from "shared/types/feature";
import { MetricInterface } from "shared/types/metric";
import { DataSourceInterface } from "shared/types/datasource";
import { SUPERADMIN_DEFAULT_ROLE } from "back-end/src/util/secrets";
import { getUserPermissions } from "back-end/src/util/organization.util";

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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };
  // Basic user permissions - no project-level permissions or teams
  it("should throw error if user isn't in the org", async () => {
    expect(async () =>
      getUserPermissions({ id: "base_user_not_in_org" }, testOrg, []),
    ).rejects.toThrow("User is not a member of this organization");
  });

  it("should default to a role when superAdmin is not in the org", async () => {
    expect(
      getUserPermissions(
        { id: "base_user_not_in_org", superAdmin: true },
        testOrg,
        [],
      ),
    ).toEqual({
      global: {
        environments: [],
        limitAccessByEnvironment: false,
        permissions: roleToPermissionMap(SUPERADMIN_DEFAULT_ROLE, testOrg),
      },
      projects: {},
    });
  });

  it("should not overwrite a superAdmins permissions if they are in the org", async () => {
    const userPermissions = getUserPermissions(
      { id: "base_user_123", superAdmin: true },
      {
        ...testOrg,
        members: [{ ...testOrg.members[0], role: "collaborator" }],
      },
      [],
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

  it("should build permissions for a basic noaccess user with no project-level permissions or teams correctly", async () => {
    const userPermissions = getUserPermissions(
      { id: "base_user_123" },
      {
        ...testOrg,
        members: [{ ...testOrg.members[0], role: "noaccess" }],
      },
      [],
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
    const userPermissions = getUserPermissions(
      { id: "base_user_123" },
      testOrg,
      [],
    );
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
      { id: "base_user_123" },
      {
        ...testOrg,
        members: [{ ...testOrg.members[0], role: "collaborator" }],
      },
      [],
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
      { id: "base_user_123" },
      {
        ...testOrg,
        members: [{ ...testOrg.members[0], role: "engineer" }],
      },
      [],
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
      { id: "base_user_123" },
      {
        ...testOrg,
        members: [{ ...testOrg.members[0], role: "analyst" }],
      },
      [],
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
      { id: "base_user_123" },
      {
        ...testOrg,
        members: [{ ...testOrg.members[0], role: "experimenter" }],
      },
      [],
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
      { id: "base_user_123" },
      {
        ...testOrg,
        members: [{ ...testOrg.members[0], role: "admin" }],
      },
      [],
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
      { id: "base_user_123" },
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
      [],
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
      { id: "base_user_123" },
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
      [],
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
      { id: "base_user_123" },
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
      [],
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
      { id: "base_user_123" },
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
      [],
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
      { id: "base_user_123" },
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
      [],
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
      { id: "base_user_123" },
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
      [],
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
      { id: "base_user_123" },
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
      [],
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
      { id: "base_user_123" },
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
      teams,
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
      { id: "base_user_123" },
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
      teams,
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
      { id: "base_user_123" },
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
      teams,
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
      { id: "base_user_123" },
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
      teams,
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
      { id: "base_user_123" },
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
      teams,
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
      { id: "base_user_123" },
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
      teams,
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
      { id: "base_user_123" },
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
      teams,
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
      { id: "base_user_123" },
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
      teams,
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
      { id: "base_user_123" },
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
      teams,
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
      { id: "base_user_123" },
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
      teams,
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
      { id: "base_user_123" },
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
      teams,
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
      { id: "base_user_123" },
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
      teams,
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
      { id: "base_user_123" },
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
      teams,
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
      { id: "base_user_123" },
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
      teams,
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
      { id: "base_user_123" },
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
      teams,
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

describe("PermissionsUtilClass.canReadSingleProjectResource check for features", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("User with global noaccess role shouldn't be able to see any features", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("noaccess", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    const features: Partial<FeatureInterface>[] = [
      {
        id: "test-feature-123",
        project: "",
      },
    ];

    const filteredFeatures = features.filter((feature) =>
      permissions.canReadSingleProjectResource(feature.project),
    );

    expect(filteredFeatures).toEqual([]);
  });

  it("User with global noaccess role shouldn't be able to see any features if the feature none of the features have the project property defined", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("noaccess", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    const features: Partial<FeatureInterface>[] = [
      {
        id: "test-feature-123",
      },
    ];

    const filteredFeatures = features.filter((feature) =>
      permissions.canReadSingleProjectResource(feature.project),
    );

    expect(filteredFeatures).toEqual([]);
  });

  it("User with global readonly role should be able to see any features", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    const features: Partial<FeatureInterface>[] = [
      {
        id: "test-feature-123",
        project: "",
      },
    ];

    const filteredFeatures = features.filter((feature) =>
      permissions.canReadSingleProjectResource(feature.project),
    );

    expect(filteredFeatures).toEqual([
      {
        id: "test-feature-123",
        project: "",
      },
    ]);
  });

  it("User with global noaccess role should be able to see any features with a project, but they should be able to see features in the project they have a readonly role for", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("noaccess", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        project1: {
          permissions: roleToPermissionMap("readonly", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        project2: {
          permissions: roleToPermissionMap("readonly", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    const features: Partial<FeatureInterface>[] = [
      {
        id: "test-feature-123",
        project: "",
      },
      {
        id: "test-feature-345",
        project: "project1",
      },
      {
        id: "test-feature-567",
        project: "project1",
      },
      {
        id: "test-feature-890",
        project: "project3",
      },
    ];

    const filteredFeatures = features.filter((feature) =>
      permissions.canReadSingleProjectResource(feature.project),
    );

    expect(filteredFeatures).toEqual([
      {
        id: "test-feature-345",
        project: "project1",
      },
      {
        id: "test-feature-567",
        project: "project1",
      },
    ]);
  });
});

describe("PermissionsUtilClass.canReadMultiProjectResource check for metrics", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("User with global noaccess role should be able to see metrics in 'All Projects' aka - an empty projects array, if they have atleast 1 project level role that grants them access", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("noaccess", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        project1: {
          permissions: roleToPermissionMap("readonly", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    const metrics: Partial<MetricInterface>[] = [
      {
        id: "test-feature-123",
        projects: [],
      },
    ];

    const filteredMetrics = metrics.filter((metric) =>
      permissions.canReadMultiProjectResource(metric.projects),
    );

    expect(filteredMetrics).toEqual([
      {
        id: "test-feature-123",
        projects: [],
      },
    ]);
  });

  it("User with global noaccess role should be able to see metrics in 'All Projects' aka - an undefined projects, if they have atleast 1 project level role that grants them access", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("noaccess", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        project1: {
          permissions: roleToPermissionMap("readonly", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    const metrics: Partial<MetricInterface>[] = [
      {
        id: "test-feature-123",
      },
    ];

    const filteredMetrics = metrics.filter((metric) =>
      permissions.canReadMultiProjectResource(metric.projects),
    );

    expect(filteredMetrics).toEqual([
      {
        id: "test-feature-123",
      },
    ]);
    expect(filteredMetrics.length).toEqual(1);
  });

  it("User with global noaccess role should not be able to see metrics in 'All Projects' aka - an undefined projects, if they don't have atleast 1 project level role that grants them access", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("noaccess", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    const metrics: Partial<MetricInterface>[] = [
      {
        id: "test-feature-123",
      },
    ];

    const filteredMetrics = metrics.filter((metric) =>
      permissions.canReadMultiProjectResource(metric.projects),
    );

    expect(filteredMetrics).toEqual([]);
    expect(filteredMetrics.length).toEqual(0);
  });

  it("User with global noaccess role shouldn't be able to see metrics if the metrics are exlusively in projects they don't have a specific role that grants them read access for", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("noaccess", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    const metrics: Partial<MetricInterface>[] = [
      {
        id: "test-feature-123",
        projects: ["project123"],
      },
    ];

    const filteredMetrics = metrics.filter((metric) =>
      permissions.canReadMultiProjectResource(metric.projects),
    );

    expect(filteredMetrics).toEqual([]);
  });

  it("User with global noaccess role should be able to see metrics if the user as readData permission for atleast one of the metrics projects", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("noaccess", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        project123: {
          permissions: roleToPermissionMap("readonly", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    const metrics: Partial<MetricInterface>[] = [
      {
        id: "test-feature-123",
        projects: ["project123", "project345"],
      },
    ];

    const filteredMetrics = metrics.filter((metric) =>
      permissions.canReadMultiProjectResource(metric.projects),
    );

    expect(filteredMetrics).toEqual([
      {
        id: "test-feature-123",
        projects: ["project123", "project345"],
      },
    ]);
  });

  it("User with global readonly role should not be able to see metrics if the user has noaccess permission for every one of the metrics projects", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        project123: {
          permissions: roleToPermissionMap("noaccess", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        project345: {
          permissions: roleToPermissionMap("noaccess", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    const metrics: Partial<MetricInterface>[] = [
      {
        id: "test-feature-123",
        projects: ["project123", "project345"],
      },
    ];

    const filteredMetrics = metrics.filter((metric) =>
      permissions.canReadMultiProjectResource(metric.projects),
    );

    expect(filteredMetrics).toEqual([]);
  });
});

describe("PermissionsUtilClass.canCreateAttribute check", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("User with global readonly role can not create attribute in 'All Projects'", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateAttribute({})).toEqual(false);
  });

  it("User with global engineer role can create attribute in in 'All Projects'", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("engineer", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateAttribute({})).toEqual(true);
  });

  it("User with global readonly role can not create attribute in in project 'ABC123'", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateAttribute({ projects: ["ABC123"] })).toEqual(
      false,
    );
  });

  it("User with global readonly role can create attribute in in project 'ABC123' if they have an engineer role for that project", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        ABC123: {
          permissions: roleToPermissionMap("engineer", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    expect(permissions.canCreateAttribute({ projects: ["ABC123"] })).toEqual(
      true,
    );
  });

  it("User with global engineer role can not create attribute in in project 'ABC123' if they have a readonly role for that project", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("engineer", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        ABC123: {
          permissions: roleToPermissionMap("readonly", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    expect(permissions.canCreateAttribute({ projects: ["ABC123"] })).toEqual(
      false,
    );
  });

  it("User with global readonly role can not create attribute in in project 'ABC123' and 'DEF456 if they have a engineer role for only one of the projects", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        ABC123: {
          permissions: roleToPermissionMap("engineer", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    expect(
      permissions.canCreateAttribute({ projects: ["ABC123", "DEF456"] }),
    ).toEqual(false);
  });

  it("User with global readonly role can create attribute in in project 'ABC123' and 'DEF456 if they have a engineer role for both projects", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        ABC123: {
          permissions: roleToPermissionMap("engineer", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        DEF456: {
          permissions: roleToPermissionMap("engineer", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    expect(
      permissions.canCreateAttribute({ projects: ["ABC123", "DEF456"] }),
    ).toEqual(true);
  });
});

describe("PermissionsUtilClass.canUpdateAttribute check", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("User with global readonly role and engineer role on project ABC123 can not remove all projects from existing attribute", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        ABC123: {
          permissions: roleToPermissionMap("engineer", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    expect(
      permissions.canUpdateAttribute(
        { projects: ["ABC123"] },
        { projects: [] },
      ),
    ).toEqual(false);
  });

  it("User with global engineer role can remove all projects from existing attribute", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("engineer", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(
      permissions.canUpdateAttribute(
        { projects: ["ABC123"] },
        { projects: [] },
      ),
    ).toEqual(true);
  });

  it("User with global readonly role can update an attribute from being in project ABC123 to being in ABC123 and DEF456", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        ABC123: {
          permissions: roleToPermissionMap("engineer", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        DEF456: {
          permissions: roleToPermissionMap("engineer", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    expect(
      permissions.canUpdateAttribute(
        { projects: ["ABC123"] },
        { projects: ["ABC123", "DEF456"] },
      ),
    ).toEqual(true);
  });
});

describe("PermissionsUtilClass.canDeleteAttribute check", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("User with global readonly role can not delete attribute in 'All Projects'", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canDeleteAttribute({})).toEqual(false);
  });

  it("User with global engineer role can delete attribute in in 'All Projects'", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("engineer", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canDeleteAttribute({})).toEqual(true);
  });

  it("User with global readonly role can not delete attribute in in project 'ABC123'", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canDeleteAttribute({ projects: ["ABC123"] })).toEqual(
      false,
    );
  });

  it("User with global readonly role can delete attribute in in project 'ABC123' if they have an engineer role for that project", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        ABC123: {
          permissions: roleToPermissionMap("engineer", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    expect(permissions.canDeleteAttribute({ projects: ["ABC123"] })).toEqual(
      true,
    );
  });

  it("User with global engineer role can not delete attribute in in project 'ABC123' if they have a readonly role for that project", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("engineer", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        ABC123: {
          permissions: roleToPermissionMap("readonly", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    expect(permissions.canDeleteAttribute({ projects: ["ABC123"] })).toEqual(
      false,
    );
  });

  it("User with global readonly role can not delete attribute in in project 'ABC123' and 'DEF456 if they have a engineer role for only one of the projects", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        ABC123: {
          permissions: roleToPermissionMap("engineer", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    expect(
      permissions.canDeleteAttribute({ projects: ["ABC123", "DEF456"] }),
    ).toEqual(false);
  });

  it("User with global readonly role can delete attribute in in project 'ABC123' and 'DEF456 if they have a engineer role for both projects", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        ABC123: {
          permissions: roleToPermissionMap("engineer", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        DEF456: {
          permissions: roleToPermissionMap("engineer", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    expect(
      permissions.canDeleteAttribute({ projects: ["ABC123", "DEF456"] }),
    ).toEqual(true);
  });
});

describe("PermissionsUtilClass.canCreateSegmentcheck", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("User with global readonly role can not create segment", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateSegment({ projects: [] })).toEqual(false);
  });

  it("User with global readonly role, but project level analyst role can not create segment in All Projects, but can create a segment in the project where they have analyst permissions", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        ABC123: {
          permissions: roleToPermissionMap("analyst", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    expect(permissions.canCreateSegment({ projects: [] })).toEqual(false);
    expect(permissions.canCreateSegment({ projects: ["ABC123"] })).toEqual(
      true,
    );
  });

  it("User with global collaborator role can create segment", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("collaborator", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateSegment({ projects: [] })).toEqual(false);
  });

  it("User with global analyst role can create segment", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("analyst", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateSegment({ projects: [] })).toEqual(true);
  });
});

describe("PermissionsUtilClass.canUpdateSegmentcheck", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("User with global readonly role can not update segment", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canUpdateSegment({ projects: [] }, {})).toEqual(false);
  });

  it("User with global readonly role, but project level analyst role can not update segment in All Projects, but can update a segment in the project where they have analyst permissions", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        ABC123: {
          permissions: roleToPermissionMap("analyst", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        DEF456: {
          permissions: roleToPermissionMap("analyst", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    expect(permissions.canUpdateSegment({ projects: [] }, {})).toEqual(false);
    expect(
      permissions.canUpdateSegment({ projects: ["ABC123"] }, { projects: [] }),
    ).toEqual(false);
    expect(
      permissions.canUpdateSegment(
        { projects: ["ABC123"] },
        { projects: ["ABC123", "DEF456"] },
      ),
    ).toEqual(true);
  });

  it("User with global collaborator role can update segment", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("collaborator", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canUpdateSegment({ projects: [] }, {})).toEqual(false);
  });

  it("User with global analyst role can update segment", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("analyst", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canUpdateSegment({ projects: [] }, {})).toEqual(true);
  });
});

describe("PermissionsUtilClass.canDeleteSegmentcheck", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("User with global readonly role can not delete segment", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canDeleteSegment({ projects: [] })).toEqual(false);
  });

  it("User with global readonly role, but project level analyst role can not delete segment in All Projects, but can delete a segment in the project where they have analyst permissions", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        ABC123: {
          permissions: roleToPermissionMap("analyst", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        DEF456: {
          permissions: roleToPermissionMap("analyst", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    expect(permissions.canDeleteSegment({ projects: [] })).toEqual(false);
    expect(permissions.canDeleteSegment({ projects: ["ABC123"] })).toEqual(
      true,
    );
  });

  it("User with global collaborator role can delete segment", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("collaborator", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canDeleteSegment({ projects: [] })).toEqual(false);
  });

  it("User with global analyst role can delete segment", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("analyst", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canDeleteSegment({ projects: [] })).toEqual(true);
  });
});

// permissionsClass Global Permissions Test
describe("PermissionsUtilClass.canCreatePresentation check", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("User with global readonly role can not create presentation", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreatePresentation()).toEqual(false);
  });

  it("User with global collaborator role can create presentation", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("collaborator", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreatePresentation()).toEqual(true);
  });

  it("User with global engineer role can create presentation", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("engineer", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreatePresentation()).toEqual(true);
  });
});

describe("PermissionsUtilClass.canUpdatePresentation check", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("User with global readonly role can not update presentation", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canUpdatePresentation()).toEqual(false);
  });

  it("User with global collaborator role can update presentation", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("collaborator", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canUpdatePresentation()).toEqual(true);
  });

  it("User with global engineer role can update presentation", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("engineer", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canUpdatePresentation()).toEqual(true);
  });
});

describe("PermissionsUtilClass.canDeletePresentation check", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("User with global readonly role can not delete presentation", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canDeletePresentation()).toEqual(false);
  });

  it("User with global collaborator role can delete presentation", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("collaborator", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canDeletePresentation()).toEqual(true);
  });

  it("User with global engineer role can delete presentation", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("engineer", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canDeletePresentation()).toEqual(true);
  });
});

describe("PermissionsUtilClass.canCreateDimension check", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("User with global readonly role can not create dimension", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateDimension()).toEqual(false);
  });

  it("User with global collaborator role can create dimension", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("collaborator", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateDimension()).toEqual(false);
  });

  it("User with global analyst role can create dimension", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("analyst", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateDimension()).toEqual(true);
  });
});

describe("PermissionsUtilClass.canUpdateDimension check", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("User with global readonly role can not update dimension", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canUpdateDimension()).toEqual(false);
  });

  it("User with global collaborator role can update dimension", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("collaborator", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canUpdateDimension()).toEqual(false);
  });

  it("User with global analyst role can update dimension", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("analyst", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canUpdateDimension()).toEqual(true);
  });
});

describe("PermissionsUtilClass.canDeleteDimension check", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("User with global readonly role can not delete dimension", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canDeleteDimension()).toEqual(false);
  });

  it("User with global collaborator role can delete dimension", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("collaborator", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canDeleteDimension()).toEqual(false);
  });

  it("User with global analyst role can delete dimension", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("analyst", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canDeleteDimension()).toEqual(true);
  });
});

describe("PermissionsUtilClass.canCreateSegmentcheck", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("User with global readonly role can not create segment", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateSegment({ projects: [] })).toEqual(false);
  });

  it("User with global collaborator role can create segment", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("collaborator", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateSegment({ projects: [] })).toEqual(false);
  });

  it("User with global analyst role can create segment", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("analyst", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateSegment({ projects: [] })).toEqual(true);
  });
});

// describe("PermissionsUtilClass.canUpdateSegmentcheck", () => {
//   const testOrg: OrganizationInterface = {
//     id: "org_sktwi1id9l7z9xkjb",
//     name: "Test Org",
//     ownerEmail: "test@test.com",
//     url: "https://test.com",
//     dateCreated: new Date(),
//     invites: [],
//     members: [
//       {
//         id: "base_user_123",
//         role: "readonly",
//         dateCreated: new Date(),
//         limitAccessByEnvironment: false,
//         environments: [],
//         projectRoles: [],
//         teams: [],
//       },
//     ],
//     settings: {
//       environments: [
//         { id: "development", description: "" },
//         { id: "staging", description: "" },
//         { id: "production", description: "" },
//       ],
//     },
//   };

//   it("User with global readonly role can not update segment", async () => {
//     const permissions = new Permissions({
//       global: {
//         permissions: roleToPermissionMap("readonly", testOrg),
//         limitAccessByEnvironment: false,
//         environments: [],
//       },
//       projects: {},
//     });

//     expect(permissions.canUpdateSegment({ projects: [] })).toEqual(false);
//   });

//   it("User with global collaborator role can update segment", async () => {
//     const permissions = new Permissions({
//       global: {
//         permissions: roleToPermissionMap("collaborator", testOrg),
//         limitAccessByEnvironment: false,
//         environments: [],
//       },
//       projects: {},
//     });

//     expect(permissions.canUpdateSegment({ projects: [] })).toEqual(false);
//   });

//   it("User with global analyst role can update segment", async () => {
//     const permissions = new Permissions({
//       global: {
//         permissions: roleToPermissionMap("analyst", testOrg),
//         limitAccessByEnvironment: false,
//         environments: [],
//       },
//       projects: {},
//     });

//     expect(permissions.canUpdateSegment({ projects: [] })).toEqual(true);
//   });
// });

// describe("PermissionsUtilClass.canDeleteSegmentcheck", () => {
//   const testOrg: OrganizationInterface = {
//     id: "org_sktwi1id9l7z9xkjb",
//     name: "Test Org",
//     ownerEmail: "test@test.com",
//     url: "https://test.com",
//     dateCreated: new Date(),
//     invites: [],
//     members: [
//       {
//         id: "base_user_123",
//         role: "readonly",
//         dateCreated: new Date(),
//         limitAccessByEnvironment: false,
//         environments: [],
//         projectRoles: [],
//         teams: [],
//       },
//     ],
//     settings: {
//       environments: [
//         { id: "development", description: "" },
//         { id: "staging", description: "" },
//         { id: "production", description: "" },
//       ],
//     },
//   };

//   it("User with global readonly role can not delete segment", async () => {
//     const permissions = new Permissions({
//       global: {
//         permissions: roleToPermissionMap("readonly", testOrg),
//         limitAccessByEnvironment: false,
//         environments: [],
//       },
//       projects: {},
//     });

//     expect(permissions.canDeleteSegment({ projects: [] })).toEqual(false);
//   });

//   it("User with global collaborator role can delete segment", async () => {
//     const permissions = new Permissions({
//       global: {
//         permissions: roleToPermissionMap("collaborator", testOrg),
//         limitAccessByEnvironment: false,
//         environments: [],
//       },
//       projects: {},
//     });

//     expect(permissions.canDeleteSegment({ projects: [] })).toEqual(false);
//   });

//   it("User with global analyst role can delete segment", async () => {
//     const permissions = new Permissions({
//       global: {
//         permissions: roleToPermissionMap("analyst", testOrg),
//         limitAccessByEnvironment: false,
//         environments: [],
//       },
//       projects: {},
//     });

//     expect(permissions.canDeleteSegment({ projects: [] })).toEqual(true);
//   });
// });

// permissionsClass Project Permissions Test
describe("PermissionsUtilClass.canCreateIdea check", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("User with global readonly role can not create idea without a project", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateIdea({ project: "" })).toEqual(false);
  });

  it("User with global collaborator role can create idea without a project", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("collaborator", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateIdea({ project: "" })).toEqual(true);
  });

  it("User with global readonly role can not create idea with a project if they don't have a project specific role that gives them permission", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateIdea({ project: "abc123" })).toEqual(false);
  });

  it("User with global readonly role can create idea with a project if they do have a project specific role that gives them permission", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
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
    });

    expect(permissions.canCreateIdea({ project: "abc123" })).toEqual(true);
  });
});

describe("PermissionsUtilClass.canUpdateIdea check", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("User with global readonly role can not update idea without a project", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(
      permissions.canUpdateIdea({ project: "" }, { project: "abc123" }),
    ).toEqual(false);
  });

  it("User with global collaborator role can update idea without a project", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("collaborator", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(
      permissions.canUpdateIdea({ project: "" }, { project: "abc123" }),
    ).toEqual(true);
  });

  it("User with global readonly role can not update idea with a project if they don't have a project specific role that gives them permission", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(
      permissions.canUpdateIdea({ project: "abc123" }, { project: "" }),
    ).toEqual(false);
  });

  it("User with global readonly role can not remove project from idea if they do have a project specific role that gives them permission in the new project", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
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
    });

    expect(
      permissions.canUpdateIdea({ project: "abc123" }, { project: "" }),
    ).toEqual(false);
  });

  it("User with global readonly role can update idea's project from idea if they do have a project specific role that gives them permission in the new project", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        abc123: {
          permissions: roleToPermissionMap("collaborator", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        def456: {
          permissions: roleToPermissionMap("collaborator", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    expect(
      permissions.canUpdateIdea({ project: "abc123" }, { project: "def456" }),
    ).toEqual(true);
  });
});

describe("PermissionsUtilClass.canDeleteIdea check", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("User with global readonly role can not delete idea without a project", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canDeleteIdea({ project: "" })).toEqual(false);
  });

  it("User with global collaborator role can delete idea without a project", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("collaborator", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canDeleteIdea({ project: "" })).toEqual(true);
  });

  it("User with global readonly role can not delete idea with a project if they don't have a project specific role that gives them permission", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canDeleteIdea({ project: "abc123" })).toEqual(false);
  });

  it("User with global readonly role can delete idea with a project if they do have a project specific role that gives them permission", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
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
    });

    expect(permissions.canDeleteIdea({ project: "abc123" })).toEqual(true);
  });
});

describe("PermissionsUtilClass.canViewExperimentModal check", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("User with global readonly role can not create experiment without a project", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canViewExperimentModal()).toEqual(false);
  });

  it("User with global experimenter role can create experiment without a project", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("experimenter", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canViewExperimentModal()).toEqual(true);
  });

  it("User with global readonly role can not create experiment with a project if they don't have a project specific role that gives them permission", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canViewExperimentModal("abc123")).toEqual(false);
  });

  it("User with global readonly role can create experiment with a project if they do have a project specific role that gives them permission", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        abc123: {
          permissions: roleToPermissionMap("analyst", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    expect(permissions.canViewExperimentModal("abc123")).toEqual(true);
  });
});

describe("PermissionsUtilClass.canCreateExperiment check", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("User with global readonly role can not create experiment without a project", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateExperiment({ project: "" })).toEqual(false);
  });

  it("User with global analyst role can create experiment without a project", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("analyst", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateExperiment({ project: "" })).toEqual(true);
  });

  it("User with global readonly role can not create experiment with a project if they don't have a project specific role that gives them permission", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateExperiment({ project: "abc123" })).toEqual(
      false,
    );
  });

  it("User with global readonly role can create experiment with a project if they do have a project specific role that gives them permission", async () => {
    const permissions = new Permissions({
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
    });

    expect(permissions.canCreateExperiment({ project: "abc123" })).toEqual(
      true,
    );
  });
});

describe("PermissionsUtilClass.canUpdateExperiment check", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("User with global readonly role can not update experiment without a project", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(
      permissions.canUpdateExperiment({ project: "" }, { project: "abc123" }),
    ).toEqual(false);
  });

  it("User with global analyst role can update experiment without a project", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("analyst", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(
      permissions.canUpdateExperiment({ project: "" }, { project: "abc123" }),
    ).toEqual(true);
  });

  it("User with global readonly role can not update experiment with a project if they don't have a project specific role that gives them permission", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(
      permissions.canUpdateExperiment({ project: "abc123" }, { project: "" }),
    ).toEqual(false);
  });

  it("User with global readonly role can not remove project from experiment if they do have a project specific role that gives them permission in the new project", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
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
    });

    expect(
      permissions.canUpdateExperiment({ project: "abc123" }, { project: "" }),
    ).toEqual(false);
  });

  it("User with global readonly role can update experiment's project from experiment if they do have a project specific role that gives them permission in the new project", async () => {
    const permissions = new Permissions({
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
          permissions: roleToPermissionMap("experimenter", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    expect(
      permissions.canUpdateExperiment(
        { project: "abc123" },
        { project: "def456" },
      ),
    ).toEqual(true);
  });
});

describe("PermissionsUtilClass.canDeleteExperiment check", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("User with global readonly role can not delete experiment without a project", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canDeleteExperiment({ project: "" })).toEqual(false);
  });

  it("User with global analyst role can delete experiment without a project", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("analyst", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canDeleteExperiment({ project: "" })).toEqual(true);
  });

  it("User with global readonly role can not delete experiment with a project if they don't have a project specific role that gives them permission", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canDeleteExperiment({ project: "abc123" })).toEqual(
      false,
    );
  });

  it("User with global readonly role can delete experiment with a project if they do have a project specific role that gives them permission", async () => {
    const permissions = new Permissions({
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
    });

    expect(permissions.canDeleteExperiment({ project: "abc123" })).toEqual(
      true,
    );
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("canCreateMetric should handle undefined projects correctly for engineer user", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("engineer", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateMetric({})).toEqual(false);
  });

  it("canCreateMetric should handle undefined projects correctly for experimenter user", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("experimenter", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateMetric({})).toEqual(true);
  });

  it("canCreateMetric should handle empty projects array correctly for noaccess user", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("noaccess", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateMetric({ projects: [] })).toEqual(false);
  });

  it("canCreateMetric should handle empty projects array correctly for experimenter user", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("experimenter", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateMetric({ projects: [] })).toEqual(true);
  });

  it("canCreateMetric should handle valid projects array correctly for noaccess user", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("noaccess", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateMetric({ projects: ["abc123"] })).toEqual(
      false,
    );
  });

  it("canCreateMetric should handle valid projects array correctly for experimenter user", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("experimenter", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateMetric({ projects: ["abc123"] })).toEqual(true);
  });

  it("canCreateMetric should handle valid projects array correctly for experimenter user with project-level readonly role", async () => {
    const permissions = new Permissions({
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
    });

    expect(permissions.canCreateMetric({ projects: ["abc123"] })).toEqual(
      false,
    );
  });

  it("canCreateMetric should handle valid projects array correctly for readonly user with project-level experimenter role in only 1 of the two projects", async () => {
    const permissions = new Permissions({
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
    });

    expect(
      // its false since the user doesn't have permission in all projects
      permissions.canCreateMetric({ projects: ["abc123", "def456"] }),
    ).toEqual(false);
  });

  it("canCreateMetric should handle valid projects array correctly for readonly user with project-level experimenter and analyst roles", async () => {
    const permissions = new Permissions({
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
    });

    expect(
      // its true since the user DOES have permission in all projects
      permissions.canCreateMetric({ projects: ["abc123", "def456"] }),
    ).toEqual(true);
  });

  it("canCreateMetric should block creation if the user isn't an admin and the metric is managed by admin", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("experimenter", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(
      permissions.canCreateMetric({ projects: ["abc123"], managedBy: "admin" }),
    ).toEqual(false);
  });

  it("canCreateMetric should allow creation if the user is an admin and the metric is managed by admin", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("admin", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(
      permissions.canCreateMetric({ projects: ["abc123"], managedBy: "admin" }),
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("canUpdateMetric should not allow updates if the user is an engineer (and doesn't have permission)", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("engineer", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

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
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("experimenter", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

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
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("experimenter", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    const metric: Pick<MetricInterface, "projects" | "managedBy"> = {
      projects: ["abc123"],
      managedBy: "",
    };

    const updates: Pick<MetricInterface, "projects"> = {};

    expect(permissions.canUpdateMetric(metric, updates)).toEqual(true);
  });

  it("canUpdateMetric should allow updates if the updates if the projects changed, but the user has permission in all of the projects", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("experimenter", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

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
    const permissions = new Permissions({
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
    });

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
    const permissions = new Permissions({
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
    });

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
    const permissions = new Permissions({
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
    });

    const metric: Pick<MetricInterface, "projects" | "managedBy"> = {
      projects: ["def456"],
      managedBy: "",
    };

    const updates: Pick<MetricInterface, "projects"> = {
      projects: [],
    };

    expect(permissions.canUpdateMetric(metric, updates)).toEqual(false);
  });

  it("canUpdateMetric should allow updates if the user is an admin and the metric is managed by admin", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("admin", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    const metric: Pick<MetricInterface, "projects" | "managedBy"> = {
      projects: ["def456"],
      managedBy: "admin",
    };

    const updates: Pick<MetricInterface, "projects"> = {
      projects: [],
    };

    expect(permissions.canUpdateMetric(metric, updates)).toEqual(true);
  });

  it("canUpdateMetric should not allow updates if the user is an experimenter and the metric is managed by admin", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("experimenter", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    const metric: Pick<MetricInterface, "projects" | "managedBy"> = {
      projects: ["def456"],
      managedBy: "admin",
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("canDeleteMetric should handle undefined projects correctly for engineer user", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("engineer", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canDeleteMetric({})).toEqual(false);
  });

  it("canDeleteMetric should handle undefined projects correctly for experimenter user", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("experimenter", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canDeleteMetric({})).toEqual(true);
  });

  it("canDeleteMetric should handle empty projects array correctly for noaccess user", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("noaccess", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canDeleteMetric({ projects: [] })).toEqual(false);
  });

  it("canCreateMetric should handle empty projects array correctly for experimenter user", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("experimenter", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateMetric({ projects: [] })).toEqual(true);
  });

  it("canCreateMetric should handle valid projects array correctly for noaccess user", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("noaccess", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateMetric({ projects: ["abc123"] })).toEqual(
      false,
    );
  });

  it("canCreateMetric should handle valid projects array correctly for experimenter user", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("experimenter", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateMetric({ projects: ["abc123"] })).toEqual(true);
  });

  it("canCreateMetric should handle valid projects array correctly for experimenter user with project-level readonly role", async () => {
    const permissions = new Permissions({
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
    });

    expect(permissions.canCreateMetric({ projects: ["abc123"] })).toEqual(
      false,
    );
  });

  it("canCreateMetric should handle valid projects array correctly for readonly user with project-level experimenter role in only 1 of the two projects", async () => {
    const permissions = new Permissions({
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
    });

    expect(
      // its false since the user doesn't have permission in all projects
      permissions.canCreateMetric({ projects: ["abc123", "def456"] }),
    ).toEqual(false);
  });

  it("canCreateMetric should handle valid projects array correctly for readonly user with project-level experimenter and analyst roles", async () => {
    const permissions = new Permissions({
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
    });

    expect(
      // its true since the user DOES have permission in all projects
      permissions.canCreateMetric({ projects: ["abc123", "def456"] }),
    ).toEqual(true);
  });

  it("canDeleteMetric should not allow deletion if the user is an experimenter and the metric is managed by admin", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("experimenter", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(
      permissions.canDeleteMetric({ projects: ["abc123"], managedBy: "admin" }),
    ).toEqual(false);
  });

  it("canDeleteMetric should allow deletion if the user is an admin and the metric is managed by admin", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("admin", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(
      permissions.canDeleteMetric({ projects: ["abc123"], managedBy: "admin" }),
    ).toEqual(true);
  });
});

describe("PermissionsUtilClass.canCreateFactTable check", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("canCreateFactTable should return false if user's global role is engineer and user is in All Projects", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("engineer", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateFactTable({ projects: [] })).toEqual(false);
  });

  it("canCreateFactTable should return true if user's global role is analyst and user is in All Projects", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("analyst", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateFactTable({ projects: [] })).toEqual(true);
  });

  it("canCreateFactTable should return true if user's global role is analyst and user is in a specific project and doesn't have a project-specific role for that project", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("analyst", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateFactTable({ projects: ["abc123"] })).toEqual(
      true,
    );
  });

  it("canCreateFactTable should return false if user's global role is analyst and user is in a specific project and does have a project-specific role for that project that doesn't provide the permission", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("analyst", testOrg),
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
    });

    expect(permissions.canCreateFactTable({ projects: ["abc123"] })).toEqual(
      false,
    );
  });

  it("canCreateFactTable should return true if user's global role is readonly and user is in a specific project and does have a project-specific role for that project that provides the permission", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        abc123: {
          permissions: roleToPermissionMap("analyst", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    expect(permissions.canCreateFactTable({ projects: ["abc123"] })).toEqual(
      true,
    );
  });
});

describe("PermissionsUtilClass.canUpdateFactTable check", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("canUpdateFactTable should return true if user has global analyst role and no project specific roles", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("analyst", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(
      permissions.canUpdateFactTable(
        { projects: [] },
        { projects: ["abc123"] },
      ),
    ).toEqual(true);
  });

  it("canUpdateFactTable should return false if user has global engineer role and no project specific roles", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("engineer", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(
      permissions.canUpdateFactTable(
        { projects: [] },
        { projects: ["abc123"] },
      ),
    ).toEqual(false);
  });

  it("canUpdateFactTable should return false if user has global engineer role and attempts to convert a Fact Table from being in one project, to being in All Projects", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("engineer", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        abc123: {
          permissions: roleToPermissionMap("analyst", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    expect(
      permissions.canUpdateFactTable(
        { projects: ["abc123"] },
        { projects: [] },
      ),
    ).toEqual(false);
  });

  it("canUpdateFactTable should return true if user has global engineer role and attempts to convert a Fact Table from being in one project, to being in two projects, if the user has permission in both projects", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("engineer", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        abc123: {
          permissions: roleToPermissionMap("analyst", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        def456: {
          permissions: roleToPermissionMap("analyst", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    expect(
      permissions.canUpdateFactTable(
        { projects: ["abc123"] },
        { projects: ["abc123", "def456"] },
      ),
    ).toEqual(true);
  });
});

describe("PermissionsUtilClass.canDeleteFactTable check", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("canDeleteFactTable should return false if user's global role is engineer and user is in All Projects", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("engineer", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canDeleteFactTable({ projects: [] })).toEqual(false);
  });

  it("canDeleteFactTable should return true if user's global role is analyst and user is in All Projects", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("analyst", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canDeleteFactTable({ projects: [] })).toEqual(true);
  });

  it("canDeleteFactTable should return true if user's global role is analyst and user is in a specific project and doesn't have a project-specific role for that project", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("analyst", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canDeleteFactTable({ projects: ["abc123"] })).toEqual(
      true,
    );
  });

  it("canDeleteFactTable should return false if user's global role is analyst and user is in a specific project and does have a project-specific role for that project that doesn't provide the permission", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("analyst", testOrg),
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
    });

    expect(permissions.canDeleteFactTable({ projects: ["abc123"] })).toEqual(
      false,
    );
  });

  it("canDeleteFactTable should return true if user's global role is readonly and user is in a specific project and does have a project-specific role for that project that provides the permission", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        abc123: {
          permissions: roleToPermissionMap("analyst", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    expect(permissions.canDeleteFactTable({ projects: ["abc123"] })).toEqual(
      true,
    );
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };
  it("canAddComment returns true for user with global experimenter role on experiment in 'All Projects'", () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("experimenter", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canAddComment([])).toEqual(true);
  });
  it("canAddComment returns true for user with global experimenter role on experiment in 'abc123'", () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("experimenter", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canAddComment(["abc123"])).toEqual(true);
  });
  it("canAddComment returns false for user with global readonly role on experiment in 'All Projects'", () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("readonly", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canAddComment([])).toEqual(false);
  });
  it("canAddComment returns false for user with global noaccess role on experiment in 'abc123'", () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("noaccess", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canAddComment(["abc123"])).toEqual(false);
  });
  it("canAddComment returns true for user with global noaccess role and experimenter role for project 'abc123' for an experiment in 'abc123'", () => {
    const permissions = new Permissions({
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
    });

    expect(permissions.canAddComment(["abc123"])).toEqual(true);
  });
  it("canAddComment returns false for user with global noaccess role and project-level experimenter role, but checking for a different project", () => {
    const permissions = new Permissions({
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
    });

    expect(permissions.canAddComment(["def123"])).toEqual(false);
  });
  it("canAddComment returns true for user with global noaccess role and project-level experimenter role for metric in multiple projects, including the project they have permission for", () => {
    const permissions = new Permissions({
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
    });

    expect(permissions.canAddComment(["abc123", "def123", "hij123"])).toEqual(
      true,
    );
  });
  it("canAddComment returns false for user with global noaccess role on experiment in 'def123'", () => {
    const permissions = new Permissions({
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
    });

    expect(permissions.canAddComment(["abc123", "def123", "hij123"])).toEqual(
      false,
    );
  });
  // This is a test specific to the putUpload endpoint - the user needs to have addComment permission either globally, or in atleast 1 project in order to be able to upload images
  it("canAddComment returns true for user with global noaccess role and 1 project level experimenter role", () => {
    const permissions = new Permissions({
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
    });

    expect(permissions.canAddComment([])).toEqual(true);
  });
});

describe("PermissionsUtilClass.canCreateProjects check", () => {
  // These tests are pretty basic right now since we don't have custom roles and only admins can edit projects, we will expand these when custom roles become available
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("canCreateProjects returns false for user with global experimenter role", () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("experimenter", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateProjects()).toEqual(false);
  });

  it("canCreateProjects returns true for user with global admin role", () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("admin", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateProjects()).toEqual(true);
  });

  //TODO: When we add custom roles, add tests here
});

describe("PermissionsUtilClass.canUpdateProject check", () => {
  // These tests are pretty basic right now since we don't have custom roles and only admins can edit projects, we will expand these when custom roles become available
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("canUpdateProject returns false for user with global experimenter role", () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("experimenter", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canUpdateProject("abc123")).toEqual(false);
  });

  it("canUpdateProject returns true for user with global admin role", () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("admin", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canUpdateProject("abc123")).toEqual(true);
  });

  //TODO: When we add custom roles, add tests here
});

describe("PermissionsUtilClass.canDeleteProject check", () => {
  // These tests are pretty basic right now since we don't have custom roles and only admins can edit projects, we will expand these when custom roles become available
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("canDeleteProject returns false for user with global experimenter role", () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("experimenter", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canDeleteProject("abc123")).toEqual(false);
  });

  it("canDeleteProject returns true for user with global admin role", () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("admin", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canDeleteProject("abc123")).toEqual(true);
  });

  //TODO: When we add custom roles, add tests here
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("User with experimenter role unable to bypassApprovalCheck", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("experimenter", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canBypassApprovalChecks({ project: "" })).toEqual(false);
  });

  it("User with admin role able to bypassApprovalCheck", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("admin", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("User with experimenter role able to reviewFeatureDrafts", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("experimenter", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canReviewFeatureDrafts({ project: "" })).toEqual(true);
  });

  it("User with engineer role able to reviewFeatureDrafts", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("engineer", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canReviewFeatureDrafts({ project: "" })).toEqual(true);
  });

  it("User with anaylst role able to reviewFeatureDrafts", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("analyst", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canReviewFeatureDrafts({ project: "" })).toEqual(false);
  });

  it("User with global readonly role, but experimenter role on project 'abc123', should be able to reivew features in project 'abc123'", async () => {
    const permissions = new Permissions({
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
    });

    expect(permissions.canReviewFeatureDrafts({ project: "abc123" })).toEqual(
      true,
    );
  });

  it("User with global experimenter role, but readonly role on project 'abc123', should be able to reivew features in project 'abc123'", async () => {
    const permissions = new Permissions({
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
    });

    expect(permissions.canReviewFeatureDrafts({ project: "abc123" })).toEqual(
      false,
    );
  });

  it("User with admin role able to bypassApprovalCheck", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("admin", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canReviewFeatureDrafts({ project: "" })).toEqual(true);
  });
});

describe("PermissionsUtilClass.canCreateVisualChange", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("User with global visualEditor role able to createVisualChange", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("visualEditor", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateVisualChange({})).toEqual(true);
  });

  it("User with global collaborator role not able to createVisualChange", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("collaborator", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateVisualChange({})).toEqual(false);
  });

  it("User with global collaborator role and project-specific visualEditor role able to createVisualChange", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("collaborator", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        ABC123: {
          permissions: roleToPermissionMap("visualEditor", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    expect(permissions.canCreateVisualChange({ project: "ABC123" })).toEqual(
      true,
    );
  });

  it("User with global collaborator role and project-specific visualEditor role not able to createVisualChange if experiment is not in a project", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("collaborator", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        ABC123: {
          permissions: roleToPermissionMap("visualEditor", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    expect(permissions.canCreateVisualChange({})).toEqual(false);
  });

  it("user with global engineer role able to createVisualChange", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("engineer", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateVisualChange({})).toEqual(true);
  });

  it("user with global analyst role able to createVisualChange", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("analyst", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateVisualChange({})).toEqual(true);
  });

  it("user with global experimenter role able to createVisualChange", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("experimenter", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateVisualChange({})).toEqual(true);
  });
});

describe("PermissionsUtilClass.canCreateDataSource", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("User with admin role able to create a data source", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("admin", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(
      permissions.canCreateDataSource({ projects: [], type: undefined }),
    ).toEqual(true);
  });

  it("User with engineer role is not able to create a data source", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("engineer", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(
      permissions.canCreateDataSource({ projects: [], type: undefined }),
    ).toEqual(false);
  });
});

describe("PermissionsUtilClass.canUpdateDataSourceParams", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("User with admin role able to update a data source's params", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("admin", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(
      permissions.canUpdateDataSourceParams({ projects: [], type: undefined }),
    ).toEqual(true);
  });

  it("User with engineer role is not able to create a data source's params", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("engineer", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(
      permissions.canUpdateDataSourceParams({ projects: [], type: undefined }),
    ).toEqual(false);
  });

  it("User with admin role can't update a growthbook_clickhouse source's params", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("admin", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(
      permissions.canUpdateDataSourceParams({
        projects: [],
        type: "growthbook_clickhouse",
      }),
    ).toEqual(false);
  });
});

describe("PermissionsUtilClass.canUpdateDataSourceSettings", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("User with admin role able to update a data source's settings", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("admin", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canUpdateDataSourceSettings({ projects: [] })).toEqual(
      true,
    );
  });

  it("User with engineer role is not able to update a data source's settings", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("engineer", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canUpdateDataSourceSettings({ projects: [] })).toEqual(
      false,
    );
  });

  it("User with analyst role is is able to update a data source's settings", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("analyst", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canUpdateDataSourceSettings({ projects: [] })).toEqual(
      true,
    );
  });

  it("User with experimenter role is able to update a data source's settings", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("experimenter", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canUpdateDataSourceSettings({ projects: [] })).toEqual(
      true,
    );
  });

  it("User with global noaccess role and project-level experimenter role is able to update a data source's settings", async () => {
    const permissions = new Permissions({
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
    });

    expect(
      permissions.canUpdateDataSourceSettings({ projects: ["abc123"] }),
    ).toEqual(true);
  });

  it("User with global noaccess role and project-level experimenter role is not able to update a data source's settings if the data source is in all projects", async () => {
    const permissions = new Permissions({
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
    });

    expect(permissions.canUpdateDataSourceSettings({ projects: [] })).toEqual(
      false,
    );
  });

  it("User with global noaccess role and project-level experimenter role is not able to update a data source's settings if the data source is in all projects", async () => {
    const permissions = new Permissions({
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
    });

    expect(
      permissions.canUpdateDataSourceSettings({
        projects: ["abc123", "def123"],
      }),
    ).toEqual(false);
  });
});

describe("PermissionsUtilClass.canDeleteDataSource", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("User with admin role able delete a data source", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("admin", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canDeleteDataSource({ projects: [] })).toEqual(true);
  });

  it("User with engineer role is not able delete a data source", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("engineer", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canDeleteDataSource({ projects: [] })).toEqual(false);
  });
});

describe("PermissionsUtilClass.canRunTestQueries check", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };
  it("canRunTestQueries returns false for user with global 'engineer' role", () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("engineer", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    const sampleDataSource: Pick<DataSourceInterface, "id" | "projects"> = {
      id: "data_abc",
    };

    expect(permissions.canRunTestQueries(sampleDataSource)).toEqual(false);
  });

  it("canRunTestQueries returns true for user with global 'analyst' role", () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("analyst", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    const sampleDataSource: Pick<DataSourceInterface, "id" | "projects"> = {
      id: "data_abc",
    };

    expect(permissions.canRunTestQueries(sampleDataSource)).toEqual(true);
  });

  it("canRunTestQueries returns false for user with global 'collaborator' role, and project-specific 'analyst' roles, but none in the project in question", () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("collaborator", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        abc: {
          permissions: roleToPermissionMap("analyst", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        def: {
          permissions: roleToPermissionMap("analyst", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    const sampleDataSource: Pick<DataSourceInterface, "id" | "projects"> = {
      id: "data_abc",
      projects: ["ghi", "xyz"],
    };

    expect(permissions.canRunTestQueries(sampleDataSource)).toEqual(false);
  });

  it("canRunTestQueries returns true for user with global 'collaborator' role, and project-specific 'analyst' role for atleast 1 project", () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("collaborator", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        abc: {
          permissions: roleToPermissionMap("analyst", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        def: {
          permissions: roleToPermissionMap("analyst", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    const sampleDataSource: Pick<DataSourceInterface, "id" | "projects"> = {
      id: "data_abc",
      projects: ["ghi", "xyz", "abc"],
    };

    expect(permissions.canRunTestQueries(sampleDataSource)).toEqual(true);
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("User with collaborator role is not able to manage feature drafts", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("collaborator", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canManageFeatureDrafts({ project: "" })).toEqual(false);
  });

  it("User with engineer role is able to manage feature drafts", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("engineer", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canManageFeatureDrafts({ project: "" })).toEqual(true);
  });

  it("User with anaylst role is not able to manage feature drafts", async () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("analyst", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canManageFeatureDrafts({ project: "" })).toEqual(false);
  });

  it("User with global readonly role is not able to manage feature drafts for feature without a project", async () => {
    const permissions = new Permissions({
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
    });

    expect(permissions.canManageFeatureDrafts({ project: "" })).toEqual(false);
  });

  it("User with global readonly role is able to manage feature drafts if their project specific permissions grant it", async () => {
    const permissions = new Permissions({
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
    });

    expect(permissions.canManageFeatureDrafts({ project: "abc123" })).toEqual(
      true,
    );
  });

  it("canManageFeatureDrafts works as expected for a feature without the project property", async () => {
    const permissions = new Permissions({
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
    });

    expect(permissions.canManageFeatureDrafts({})).toEqual(true);
  });

  it("canManageFeatureDrafts works as expected for a feature without the project property", async () => {
    const permissions = new Permissions({
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
    });

    expect(permissions.canManageFeatureDrafts({})).toEqual(false);
  });
});

describe("PermissionsUtilClass.canViewFeatureModal check", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("canViewFeatureModal returns true for user with global 'engineer' role", () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("engineer", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canViewFeatureModal()).toEqual(true);
  });

  it("canViewFeatureModal returns false for user with global 'analyst' role", () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("analyst", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canViewFeatureModal()).toEqual(false);
  });

  it("canViewFeatureModal returns true for user with global 'analyst' role, if their project-specific role gives them access", () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("analyst", testOrg),
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
    });

    expect(permissions.canViewFeatureModal("abc123")).toEqual(true);
  });
});

describe("PermissionsUtilClass.canCreateFeature check", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("canCreateFeature returns true for user with global 'engineer' role when trying to create a feature in all projects", () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("engineer", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateFeature({ project: "" })).toEqual(true);
  });

  it("canCreateFeature returns false for user with global 'analyst' role when trying to create a feature in all projects", () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("analyst", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canCreateFeature({ project: "" })).toEqual(false);
  });

  it("canCreateFeature returns true for user with global 'analyst' role when trying to create a feature in a project they have engineer permissions for", () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("analyst", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        ABC123: {
          permissions: roleToPermissionMap("engineer", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    expect(permissions.canCreateFeature({ project: "ABC123" })).toEqual(true);
  });

  it("canCreateFeature returns false for user with global 'engineer' role when trying to create a feature in a project they have analyst permissions for", () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("engineer", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        ABC123: {
          permissions: roleToPermissionMap("analyst", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    expect(permissions.canCreateFeature({ project: "ABC123" })).toEqual(false);
  });
});

describe("PermissionsUtilClass.canUpdateFeature check", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("canUpdateFeature returns true for user with global 'engineer' role when trying to update a feature in all projects", () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("engineer", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canUpdateFeature({}, { project: "abc123" })).toEqual(
      true,
    );
  });

  it("canUpdateFeature returns false for user with global 'analyst' role when trying to update a feature in a specific project and move it to all projects", () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("analyst", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        ABC123: {
          permissions: roleToPermissionMap("engineer", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    expect(
      permissions.canUpdateFeature({ project: "ABC123" }, { project: "" }),
    ).toEqual(false);
  });

  it("canUpdateFeature returns true for user with global 'analyst' role when trying to move a feature from 1 project they have engineer permissions for to another project they have engineer permissions for", () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("analyst", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        ABC123: {
          permissions: roleToPermissionMap("engineer", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        DEF456: {
          permissions: roleToPermissionMap("engineer", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    expect(
      permissions.canUpdateFeature(
        { project: "ABC123" },
        { project: "DEF456" },
      ),
    ).toEqual(true);
  });
});

describe("PermissionsUtilClass.canDeleteFeature check", () => {
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
        { id: "development", description: "" },
        { id: "staging", description: "" },
        { id: "production", description: "" },
      ],
    },
  };

  it("canDeleteFeature returns true for user with global 'engineer' role when trying to delete a feature in all projects", () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("engineer", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canDeleteFeature({ project: "" })).toEqual(true);
  });

  it("canDeleteFeature returns false for user with global 'analyst' role when trying to delete a feature in all projects", () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("analyst", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {},
    });

    expect(permissions.canDeleteFeature({ project: "" })).toEqual(false);
  });

  it("canDeleteFeature returns true for user with global 'analyst' role when trying to delete a feature in a project they have engineer permissions for", () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("analyst", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        ABC123: {
          permissions: roleToPermissionMap("engineer", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    expect(permissions.canDeleteFeature({ project: "ABC123" })).toEqual(true);
  });

  it("canDeleteFeature returns false for user with global 'engineer' role when trying to delete a feature in a project they have analyst permissions for", () => {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("engineer", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        ABC123: {
          permissions: roleToPermissionMap("analyst", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    expect(permissions.canDeleteFeature({ project: "ABC123" })).toEqual(false);
  });
});
