import { getReadAccessFilter, hasReadAccess } from "shared/permissions";
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
      getUserPermissions({ id: "base_user_not_in_org" }, testOrg, [])
    ).rejects.toThrow("User is not a member of this organization");
  });

  it("should default to readonly access when superAdmin is not in the org", async () => {
    expect(
      getUserPermissions(
        { id: "base_user_not_in_org", superAdmin: true },
        testOrg,
        []
      )
    ).toEqual({
      global: {
        environments: [],
        limitAccessByEnvironment: false,
        permissions: roleToPermissionMap("readonly", testOrg),
      },
      projects: {},
    });
  });

  it("should not overwrite a superAdmins permissions to readonly if they are in the org", async () => {
    const userPermissions = getUserPermissions(
      { id: "base_user_123", superAdmin: true },
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

  it("should build permissions for a basic noaccess user with no project-level permissions or teams correctly", async () => {
    const userPermissions = getUserPermissions(
      { id: "base_user_123" },
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
    const userPermissions = getUserPermissions(
      { id: "base_user_123" },
      testOrg,
      []
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
      { id: "base_user_123" },
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
      { id: "base_user_123" },
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
      { id: "base_user_123" },
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
      { id: "base_user_123" },
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
      { id: "base_user_123" },
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
      { id: "base_user_123" },
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
      { id: "base_user_123" },
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
      { id: "base_user_123" },
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
      { id: "base_user_123" },
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
      { id: "base_user_123" },
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
      { id: "base_user_123" },
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
      { id: "base_user_123" },
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
      { id: "base_user_123" },
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
      { id: "base_user_123" },
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
      { id: "base_user_123" },
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
      { id: "base_user_123" },
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
