import { getUserPermissions } from "../src/util/organization.util";
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
        permissions: {
          createPresentations: false,
          createDimensions: false,
          createSegments: false,
          organizationSettings: false,
          superDelete: false,
          manageTeam: false,
          manageTags: false,
          manageApiKeys: false,
          manageArchetype: false,
          manageFactTables: false,
          manageIntegrations: false,
          manageWebhooks: false,
          manageBilling: false,
          manageNorthStarMetric: false,
          manageTargetingAttributes: false,
          manageNamespaces: false,
          manageSavedGroups: false,
          viewEvents: false,
          addComments: false,
          createFeatureDrafts: false,
          manageFeatures: false,
          manageProjects: false,
          createAnalyses: false,
          createIdeas: false,
          createMetrics: false,
          createDatasources: false,
          editDatasourceSettings: false,
          runQueries: false,
          publishFeatures: false,
          manageEnvironments: false,
          runExperiments: false,
        },
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
        permissions: {
          createPresentations: true,
          createDimensions: false,
          createSegments: false,
          organizationSettings: false,
          superDelete: false,
          manageTeam: false,
          manageTags: false,
          manageApiKeys: false,
          manageArchetype: false,
          manageFactTables: false,
          manageIntegrations: false,
          manageWebhooks: false,
          manageBilling: false,
          manageNorthStarMetric: false,
          manageTargetingAttributes: false,
          manageNamespaces: false,
          manageSavedGroups: false,
          viewEvents: false,
          addComments: true,
          createFeatureDrafts: false,
          manageFeatures: false,
          manageProjects: false,
          createAnalyses: false,
          createIdeas: true,
          createMetrics: false,
          createDatasources: false,
          editDatasourceSettings: false,
          runQueries: false,
          publishFeatures: false,
          manageEnvironments: false,
          runExperiments: false,
        },
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
        permissions: {
          createPresentations: true,
          createDimensions: false,
          createSegments: false,
          organizationSettings: false,
          superDelete: false,
          manageTeam: false,
          manageTags: true,
          manageApiKeys: false,
          manageIntegrations: false,
          manageArchetype: true,
          manageFactTables: false,
          manageWebhooks: false,
          manageBilling: false,
          manageNorthStarMetric: false,
          manageTargetingAttributes: true,
          manageNamespaces: true,
          manageSavedGroups: true,
          viewEvents: false,
          addComments: true,
          createFeatureDrafts: true,
          manageFeatures: true,
          manageProjects: false,
          createAnalyses: false,
          createIdeas: true,
          createMetrics: false,
          createDatasources: false,
          editDatasourceSettings: false,
          runQueries: false,
          publishFeatures: true,
          manageEnvironments: true,
          runExperiments: true,
        },
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
        permissions: {
          createPresentations: true,
          createDimensions: true,
          createSegments: false,
          organizationSettings: false,
          superDelete: false,
          manageTeam: false,
          manageTags: true,
          manageApiKeys: false,
          manageArchetype: false,
          manageFactTables: true,
          manageIntegrations: false,
          manageWebhooks: false,
          manageBilling: false,
          manageNorthStarMetric: false,
          manageTargetingAttributes: false,
          manageNamespaces: false,
          manageSavedGroups: false,
          viewEvents: false,
          addComments: true,
          createFeatureDrafts: false,
          manageFeatures: false,
          manageProjects: false,
          createAnalyses: true,
          createIdeas: true,
          createMetrics: true,
          createDatasources: false,
          editDatasourceSettings: true,
          runQueries: true,
          publishFeatures: false,
          manageEnvironments: false,
          runExperiments: false,
        },
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
        permissions: {
          createPresentations: true,
          createDimensions: true,
          createSegments: true,
          organizationSettings: false,
          superDelete: false,
          manageTeam: false,
          manageTags: true,
          manageApiKeys: false,
          manageIntegrations: false,
          manageArchetype: true,
          manageFactTables: true,
          manageWebhooks: false,
          manageBilling: false,
          manageNorthStarMetric: false,
          manageTargetingAttributes: true,
          manageNamespaces: true,
          manageSavedGroups: true,
          viewEvents: false,
          addComments: true,
          createFeatureDrafts: true,
          manageFeatures: true,
          manageProjects: false,
          createAnalyses: true,
          createIdeas: true,
          createMetrics: true,
          createDatasources: false,
          editDatasourceSettings: true,
          runQueries: true,
          publishFeatures: true,
          manageEnvironments: true,
          runExperiments: true,
        },
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
        permissions: {
          createPresentations: true,
          createDimensions: true,
          createSegments: true,
          organizationSettings: true,
          superDelete: true,
          manageTeam: true,
          manageTags: true,
          manageApiKeys: true,
          manageIntegrations: true,
          manageArchetype: true,
          manageFactTables: true,
          manageWebhooks: true,
          manageBilling: true,
          manageNorthStarMetric: true,
          manageTargetingAttributes: true,
          manageNamespaces: true,
          manageSavedGroups: true,
          viewEvents: true,
          addComments: true,
          createFeatureDrafts: true,
          manageFeatures: true,
          manageProjects: true,
          createAnalyses: true,
          createIdeas: true,
          createMetrics: true,
          createDatasources: true,
          editDatasourceSettings: true,
          runQueries: true,
          publishFeatures: true,
          manageEnvironments: true,
          runExperiments: true,
        },
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
        permissions: {
          createPresentations: false,
          createDimensions: false,
          createSegments: false,
          organizationSettings: false,
          superDelete: false,
          manageTeam: false,
          manageTags: false,
          manageApiKeys: false,
          manageIntegrations: false,
          manageWebhooks: false,
          manageBilling: false,
          manageNorthStarMetric: false,
          manageTargetingAttributes: false,
          manageArchetype: false,
          manageFactTables: false,
          manageNamespaces: false,
          manageSavedGroups: false,
          viewEvents: false,
          addComments: false,
          createFeatureDrafts: false,
          manageFeatures: false,
          manageProjects: false,
          createAnalyses: false,
          createIdeas: false,
          createMetrics: false,
          createDatasources: false,
          editDatasourceSettings: false,
          runQueries: false,
          publishFeatures: false,
          manageEnvironments: false,
          runExperiments: false,
        },
      },
      projects: {
        prj_exl5jr5dl4rbw856: {
          environments: [],
          limitAccessByEnvironment: false,
          permissions: {
            createPresentations: true,
            createDimensions: false,
            createSegments: false,
            organizationSettings: false,
            superDelete: false,
            manageTeam: false,
            manageTags: true,
            manageApiKeys: false,
            manageIntegrations: false,
            manageArchetype: true,
            manageFactTables: false,
            manageWebhooks: false,
            manageBilling: false,
            manageNorthStarMetric: false,
            manageTargetingAttributes: true,
            manageNamespaces: true,
            manageSavedGroups: true,
            viewEvents: false,
            addComments: true,
            createFeatureDrafts: true,
            manageFeatures: true,
            manageProjects: false,
            createAnalyses: false,
            createIdeas: true,
            createMetrics: false,
            createDatasources: false,
            editDatasourceSettings: false,
            runQueries: false,
            publishFeatures: true,
            manageEnvironments: true,
            runExperiments: true,
          },
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
        permissions: {
          createPresentations: false,
          createDimensions: false,
          createSegments: false,
          organizationSettings: false,
          superDelete: false,
          manageTeam: false,
          manageTags: false,
          manageApiKeys: false,
          manageArchetype: false,
          manageFactTables: false,
          manageIntegrations: false,
          manageWebhooks: false,
          manageBilling: false,
          manageNorthStarMetric: false,
          manageTargetingAttributes: false,
          manageNamespaces: false,
          manageSavedGroups: false,
          viewEvents: false,
          addComments: false,
          createFeatureDrafts: false,
          manageFeatures: false,
          manageProjects: false,
          createAnalyses: false,
          createIdeas: false,
          createMetrics: false,
          createDatasources: false,
          editDatasourceSettings: false,
          runQueries: false,
          publishFeatures: false,
          manageEnvironments: false,
          runExperiments: false,
        },
      },
      projects: {
        prj_exl5jr5dl4rbw856: {
          environments: [],
          limitAccessByEnvironment: false,
          permissions: {
            createPresentations: true,
            createDimensions: false,
            createSegments: false,
            organizationSettings: false,
            superDelete: false,
            manageTeam: false,
            manageTags: true,
            manageApiKeys: false,
            manageIntegrations: false,
            manageWebhooks: false,
            manageBilling: false,
            manageArchetype: true,
            manageFactTables: false,
            manageNorthStarMetric: false,
            manageTargetingAttributes: true,
            manageNamespaces: true,
            manageSavedGroups: true,
            viewEvents: false,
            addComments: true,
            createFeatureDrafts: true,
            manageFeatures: true,
            manageProjects: false,
            createAnalyses: false,
            createIdeas: true,
            createMetrics: false,
            createDatasources: false,
            editDatasourceSettings: false,
            runQueries: false,
            publishFeatures: true,
            manageEnvironments: true,
            runExperiments: true,
          },
        },
        prj_exl5jr5dl4rbw123: {
          environments: [],
          limitAccessByEnvironment: false,
          permissions: {
            createPresentations: true,
            createDimensions: true,
            createSegments: false,
            organizationSettings: false,
            superDelete: false,
            manageTeam: false,
            manageTags: true,
            manageApiKeys: false,
            manageIntegrations: false,
            manageArchetype: false,
            manageFactTables: true,
            manageWebhooks: false,
            manageBilling: false,
            manageNorthStarMetric: false,
            manageTargetingAttributes: false,
            manageNamespaces: false,
            manageSavedGroups: false,
            viewEvents: false,
            addComments: true,
            createFeatureDrafts: false,
            manageFeatures: false,
            manageProjects: false,
            createAnalyses: true,
            createIdeas: true,
            createMetrics: true,
            createDatasources: false,
            editDatasourceSettings: true,
            runQueries: true,
            publishFeatures: false,
            manageEnvironments: false,
            runExperiments: false,
          },
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
        permissions: {
          createPresentations: true,
          createDimensions: false,
          createSegments: false,
          organizationSettings: false,
          superDelete: false,
          manageTeam: false,
          manageTags: true,
          manageApiKeys: false,
          manageIntegrations: false,
          manageWebhooks: false,
          manageBilling: false,
          manageNorthStarMetric: false,
          manageTargetingAttributes: true,
          manageNamespaces: true,
          manageSavedGroups: true,
          manageArchetype: true,
          manageFactTables: false,
          viewEvents: false,
          addComments: true,
          createFeatureDrafts: true,
          manageFeatures: true,
          manageProjects: false,
          createAnalyses: false,
          createIdeas: true,
          createMetrics: false,
          createDatasources: false,
          editDatasourceSettings: false,
          runQueries: false,
          publishFeatures: true,
          manageEnvironments: true,
          runExperiments: true,
        },
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
        permissions: {
          createPresentations: true,
          createDimensions: false,
          createSegments: false,
          organizationSettings: false,
          superDelete: false,
          manageTeam: false,
          manageTags: true,
          manageApiKeys: false,
          manageIntegrations: false,
          manageWebhooks: false,
          manageBilling: false,
          manageArchetype: true,
          manageFactTables: false,
          manageNorthStarMetric: false,
          manageTargetingAttributes: true,
          manageNamespaces: true,
          manageSavedGroups: true,
          viewEvents: false,
          addComments: true,
          createFeatureDrafts: true,
          manageFeatures: true,
          manageProjects: false,
          createAnalyses: false,
          createIdeas: true,
          createMetrics: false,
          createDatasources: false,
          editDatasourceSettings: false,
          runQueries: false,
          publishFeatures: true,
          manageEnvironments: true,
          runExperiments: true,
        },
      },
      projects: {
        prj_exl5jr5dl4rbw856: {
          environments: ["production"],
          limitAccessByEnvironment: true,
          permissions: {
            createPresentations: true,
            createDimensions: false,
            createSegments: false,
            organizationSettings: false,
            superDelete: false,
            manageTeam: false,
            manageTags: true,
            manageApiKeys: false,
            manageIntegrations: false,
            manageWebhooks: false,
            manageArchetype: true,
            manageFactTables: false,
            manageBilling: false,
            manageNorthStarMetric: false,
            manageTargetingAttributes: true,
            manageNamespaces: true,
            manageSavedGroups: true,
            viewEvents: false,
            addComments: true,
            createFeatureDrafts: true,
            manageFeatures: true,
            manageProjects: false,
            createAnalyses: false,
            createIdeas: true,
            createMetrics: false,
            createDatasources: false,
            editDatasourceSettings: false,
            runQueries: false,
            publishFeatures: true,
            manageEnvironments: true,
            runExperiments: true,
          },
        },
        prj_exl5jr5dl4rbw123: {
          environments: [],
          limitAccessByEnvironment: false,
          permissions: {
            createPresentations: true,
            createDimensions: true,
            createSegments: false,
            organizationSettings: false,
            superDelete: false,
            manageTeam: false,
            manageTags: true,
            manageApiKeys: false,
            manageIntegrations: false,
            manageWebhooks: false,
            manageBilling: false,
            manageNorthStarMetric: false,
            manageTargetingAttributes: false,
            manageNamespaces: false,
            manageSavedGroups: false,
            manageArchetype: false,
            manageFactTables: true,
            viewEvents: false,
            addComments: true,
            createFeatureDrafts: false,
            manageFeatures: false,
            manageProjects: false,
            createAnalyses: true,
            createIdeas: true,
            createMetrics: true,
            createDatasources: false,
            editDatasourceSettings: true,
            runQueries: true,
            publishFeatures: false,
            manageEnvironments: false,
            runExperiments: false,
          },
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
        permissions: {
          createPresentations: true,
          createDimensions: false,
          createSegments: false,
          organizationSettings: false,
          superDelete: false,
          manageTeam: false,
          manageTags: false,
          manageApiKeys: false,
          manageArchetype: false,
          manageFactTables: false,
          manageIntegrations: false,
          manageWebhooks: false,
          manageBilling: false,
          manageNorthStarMetric: false,
          manageTargetingAttributes: false,
          manageNamespaces: false,
          manageSavedGroups: false,
          viewEvents: false,
          addComments: true,
          createFeatureDrafts: false,
          manageFeatures: false,
          manageProjects: false,
          createAnalyses: false,
          createIdeas: true,
          createMetrics: false,
          createDatasources: false,
          editDatasourceSettings: false,
          runQueries: false,
          publishFeatures: false,
          manageEnvironments: false,
          runExperiments: false,
        },
      },
      projects: {
        prj_exl5jr5dl4rbw856: {
          environments: ["production"],
          limitAccessByEnvironment: true,
          permissions: {
            createPresentations: true,
            createDimensions: false,
            createSegments: false,
            organizationSettings: false,
            superDelete: false,
            manageTeam: false,
            manageTags: true,
            manageApiKeys: false,
            manageIntegrations: false,
            manageWebhooks: false,
            manageBilling: false,
            manageArchetype: true,
            manageFactTables: false,
            manageNorthStarMetric: false,
            manageTargetingAttributes: true,
            manageNamespaces: true,
            manageSavedGroups: true,
            viewEvents: false,
            addComments: true,
            createFeatureDrafts: true,
            manageFeatures: true,
            manageProjects: false,
            createAnalyses: false,
            createIdeas: true,
            createMetrics: false,
            createDatasources: false,
            editDatasourceSettings: false,
            runQueries: false,
            publishFeatures: true,
            manageEnvironments: true,
            runExperiments: true,
          },
        },
        prj_exl5jr5dl4rbw123: {
          environments: [],
          limitAccessByEnvironment: false,
          permissions: {
            createPresentations: true,
            createDimensions: true,
            createSegments: false,
            organizationSettings: false,
            superDelete: false,
            manageTeam: false,
            manageTags: true,
            manageApiKeys: false,
            manageIntegrations: false,
            manageWebhooks: false,
            manageArchetype: false,
            manageFactTables: true,
            manageBilling: false,
            manageNorthStarMetric: false,
            manageTargetingAttributes: false,
            manageNamespaces: false,
            manageSavedGroups: false,
            viewEvents: false,
            addComments: true,
            createFeatureDrafts: false,
            manageFeatures: false,
            manageProjects: false,
            createAnalyses: true,
            createIdeas: true,
            createMetrics: true,
            createDatasources: false,
            editDatasourceSettings: true,
            runQueries: true,
            publishFeatures: false,
            manageEnvironments: false,
            runExperiments: false,
          },
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
        permissions: {
          createPresentations: true,
          createDimensions: true,
          createSegments: true,
          organizationSettings: true,
          superDelete: true,
          manageTeam: true,
          manageTags: true,
          manageApiKeys: true,
          manageIntegrations: true,
          manageWebhooks: true,
          manageBilling: true,
          manageNorthStarMetric: true,
          manageTargetingAttributes: true,
          manageNamespaces: true,
          manageSavedGroups: true,
          viewEvents: true,
          addComments: true,
          manageArchetype: true,
          manageFactTables: true,
          createFeatureDrafts: true,
          manageFeatures: true,
          manageProjects: true,
          createAnalyses: true,
          createIdeas: true,
          createMetrics: true,
          createDatasources: true,
          editDatasourceSettings: true,
          runQueries: true,
          publishFeatures: true,
          manageEnvironments: true,
          runExperiments: true,
        },
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
        limitAccessByEnvironment: true,
        permissions: {
          createPresentations: true,
          createDimensions: false,
          createSegments: false,
          organizationSettings: false,
          superDelete: false,
          manageTeam: false,
          manageTags: true,
          manageApiKeys: false,
          manageIntegrations: false,
          manageWebhooks: false,
          manageBilling: false,
          manageNorthStarMetric: false,
          manageArchetype: true,
          manageFactTables: false,
          manageTargetingAttributes: true,
          manageNamespaces: true,
          manageSavedGroups: true,
          viewEvents: false,
          addComments: true,
          createFeatureDrafts: true,
          manageFeatures: true,
          manageProjects: false,
          createAnalyses: false,
          createIdeas: true,
          createMetrics: false,
          createDatasources: false,
          editDatasourceSettings: false,
          runQueries: false,
          publishFeatures: true,
          manageEnvironments: true,
          runExperiments: true,
        },
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
        permissions: {
          createPresentations: false,
          createDimensions: false,
          createSegments: false,
          organizationSettings: false,
          superDelete: false,
          manageTeam: false,
          manageTags: false,
          manageApiKeys: false,
          manageIntegrations: false,
          manageWebhooks: false,
          manageBilling: false,
          manageNorthStarMetric: false,
          manageTargetingAttributes: false,
          manageNamespaces: false,
          manageSavedGroups: false,
          viewEvents: false,
          addComments: false,
          createFeatureDrafts: false,
          manageFeatures: false,
          manageProjects: false,
          manageArchetype: false,
          manageFactTables: false,
          createAnalyses: false,
          createIdeas: false,
          createMetrics: false,
          createDatasources: false,
          editDatasourceSettings: false,
          runQueries: false,
          publishFeatures: false,
          manageEnvironments: false,
          runExperiments: false,
        },
      },
      projects: {
        prj_exl5jr5dl4rbw856: {
          environments: [],
          limitAccessByEnvironment: false,
          permissions: {
            createPresentations: true,
            createDimensions: false,
            createSegments: false,
            organizationSettings: false,
            superDelete: false,
            manageTeam: false,
            manageArchetype: true,
            manageFactTables: false,
            manageTags: true,
            manageApiKeys: false,
            manageIntegrations: false,
            manageWebhooks: false,
            manageBilling: false,
            manageNorthStarMetric: false,
            manageTargetingAttributes: true,
            manageNamespaces: true,
            manageSavedGroups: true,
            viewEvents: false,
            addComments: true,
            createFeatureDrafts: true,
            manageFeatures: true,
            manageProjects: false,
            createAnalyses: false,
            createIdeas: true,
            createMetrics: false,
            createDatasources: false,
            editDatasourceSettings: false,
            runQueries: false,
            publishFeatures: true,
            manageEnvironments: true,
            runExperiments: true,
          },
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
        permissions: {
          createPresentations: true,
          createDimensions: false,
          createSegments: false,
          organizationSettings: false,
          superDelete: false,
          manageTeam: false,
          manageTags: true,
          manageApiKeys: false,
          manageIntegrations: false,
          manageWebhooks: false,
          manageBilling: false,
          manageNorthStarMetric: false,
          manageTargetingAttributes: true,
          manageNamespaces: true,
          manageSavedGroups: true,
          viewEvents: false,
          manageArchetype: true,
          manageFactTables: false,
          addComments: true,
          createFeatureDrafts: true,
          manageFeatures: true,
          manageProjects: false,
          createAnalyses: false,
          createIdeas: true,
          createMetrics: false,
          createDatasources: false,
          editDatasourceSettings: false,
          runQueries: false,
          publishFeatures: true,
          manageEnvironments: true,
          runExperiments: true,
        },
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
        permissions: {
          createPresentations: true,
          createDimensions: true,
          createSegments: true,
          organizationSettings: true,
          superDelete: true,
          manageTeam: true,
          manageTags: true,
          manageApiKeys: true,
          manageIntegrations: true,
          manageWebhooks: true,
          manageBilling: true,
          manageNorthStarMetric: true,
          manageTargetingAttributes: true,
          manageNamespaces: true,
          manageSavedGroups: true,
          viewEvents: true,
          addComments: true,
          createFeatureDrafts: true,
          manageFeatures: true,
          manageProjects: true,
          createAnalyses: true,
          createIdeas: true,
          createMetrics: true,
          manageArchetype: true,
          manageFactTables: true,
          createDatasources: true,
          editDatasourceSettings: true,
          runQueries: true,
          publishFeatures: true,
          manageEnvironments: true,
          runExperiments: true,
        },
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
        permissions: {
          createPresentations: true,
          createDimensions: true,
          createSegments: true,
          organizationSettings: false,
          superDelete: false,
          manageTeam: false,
          manageTags: true,
          manageApiKeys: false,
          manageIntegrations: false,
          manageWebhooks: false,
          manageBilling: false,
          manageArchetype: true,
          manageFactTables: true,
          manageNorthStarMetric: false,
          manageTargetingAttributes: true,
          manageNamespaces: true,
          manageSavedGroups: true,
          viewEvents: false,
          addComments: true,
          createFeatureDrafts: true,
          manageFeatures: true,
          manageProjects: false,
          createAnalyses: true,
          createIdeas: true,
          createMetrics: true,
          createDatasources: false,
          editDatasourceSettings: true,
          runQueries: true,
          publishFeatures: true,
          manageEnvironments: true,
          runExperiments: true,
        },
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
            teams: ["team_123"],
          },
        ],
      },
      teams
    );

    expect(userPermissions).toEqual({
      global: {
        environments: ["production", "staging", "development"],
        limitAccessByEnvironment: true,
        permissions: {
          createPresentations: true,
          createDimensions: true,
          createSegments: true,
          organizationSettings: false,
          superDelete: false,
          manageTeam: false,
          manageTags: true,
          manageApiKeys: false,
          manageIntegrations: false,
          manageWebhooks: false,
          manageBilling: false,
          manageNorthStarMetric: false,
          manageTargetingAttributes: true,
          manageNamespaces: true,
          manageArchetype: true,
          manageFactTables: true,
          manageSavedGroups: true,
          viewEvents: false,
          addComments: true,
          createFeatureDrafts: true,
          manageFeatures: true,
          manageProjects: false,
          createAnalyses: true,
          createIdeas: true,
          createMetrics: true,
          createDatasources: false,
          editDatasourceSettings: true,
          runQueries: true,
          publishFeatures: true,
          manageEnvironments: true,
          runExperiments: true,
        },
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
        permissions: {
          createPresentations: false,
          createDimensions: false,
          createSegments: false,
          organizationSettings: false,
          superDelete: false,
          manageTeam: false,
          manageTags: false,
          manageApiKeys: false,
          manageIntegrations: false,
          manageWebhooks: false,
          manageArchetype: false,
          manageFactTables: false,
          manageBilling: false,
          manageNorthStarMetric: false,
          manageTargetingAttributes: false,
          manageNamespaces: false,
          manageSavedGroups: false,
          viewEvents: false,
          addComments: false,
          createFeatureDrafts: false,
          manageFeatures: false,
          manageProjects: false,
          createAnalyses: false,
          createIdeas: false,
          createMetrics: false,
          createDatasources: false,
          editDatasourceSettings: false,
          runQueries: false,
          publishFeatures: false,
          manageEnvironments: false,
          runExperiments: false,
        },
      },
      projects: {
        prj_exl5jr5dl4rbw856: {
          environments: ["development"],
          limitAccessByEnvironment: true,
          permissions: {
            createPresentations: true,
            createDimensions: true,
            createSegments: false,
            organizationSettings: false,
            superDelete: false,
            manageTeam: false,
            manageTags: true,
            manageApiKeys: false,
            manageIntegrations: false,
            manageWebhooks: false,
            manageArchetype: true,
            manageFactTables: true,
            manageBilling: false,
            manageNorthStarMetric: false,
            manageTargetingAttributes: true,
            manageNamespaces: true,
            manageSavedGroups: true,
            viewEvents: false,
            addComments: true,
            createFeatureDrafts: true,
            manageFeatures: true,
            manageProjects: false,
            createAnalyses: true,
            createIdeas: true,
            createMetrics: true,
            createDatasources: false,
            editDatasourceSettings: true,
            runQueries: true,
            publishFeatures: true,
            manageEnvironments: true,
            runExperiments: true,
          },
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
        permissions: {
          createPresentations: false,
          createDimensions: false,
          createSegments: false,
          organizationSettings: false,
          superDelete: false,
          manageTeam: false,
          manageTags: false,
          manageApiKeys: false,
          manageIntegrations: false,
          manageWebhooks: false,
          manageBilling: false,
          manageNorthStarMetric: false,
          manageTargetingAttributes: false,
          manageNamespaces: false,
          manageArchetype: false,
          manageFactTables: false,
          manageSavedGroups: false,
          viewEvents: false,
          addComments: false,
          createFeatureDrafts: false,
          manageFeatures: false,
          manageProjects: false,
          createAnalyses: false,
          createIdeas: false,
          createMetrics: false,
          createDatasources: false,
          editDatasourceSettings: false,
          runQueries: false,
          publishFeatures: false,
          manageEnvironments: false,
          runExperiments: false,
        },
      },
      projects: {
        prj_exl5jr5dl4rbw856: {
          environments: [],
          limitAccessByEnvironment: false,
          permissions: {
            createPresentations: true,
            createDimensions: true,
            createSegments: false,
            organizationSettings: false,
            superDelete: false,
            manageTeam: false,
            manageTags: true,
            manageApiKeys: false,
            manageIntegrations: false,
            manageArchetype: false,
            manageFactTables: true,
            manageWebhooks: false,
            manageBilling: false,
            manageNorthStarMetric: false,
            manageTargetingAttributes: false,
            manageNamespaces: false,
            manageSavedGroups: false,
            viewEvents: false,
            addComments: true,
            createFeatureDrafts: false,
            manageFeatures: false,
            manageProjects: false,
            createAnalyses: true,
            createIdeas: true,
            createMetrics: true,
            createDatasources: false,
            editDatasourceSettings: true,
            runQueries: true,
            publishFeatures: false,
            manageEnvironments: false,
            runExperiments: false,
          },
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
        permissions: {
          createPresentations: true,
          createDimensions: true,
          createSegments: true,
          organizationSettings: false,
          superDelete: false,
          manageTeam: false,
          manageTags: true,
          manageApiKeys: false,
          manageIntegrations: false,
          manageWebhooks: false,
          manageBilling: false,
          manageNorthStarMetric: false,
          manageTargetingAttributes: true,
          manageNamespaces: true,
          manageSavedGroups: true,
          viewEvents: false,
          addComments: true,
          manageArchetype: true,
          manageFactTables: true,
          createFeatureDrafts: true,
          manageFeatures: true,
          manageProjects: false,
          createAnalyses: true,
          createIdeas: true,
          createMetrics: true,
          createDatasources: false,
          editDatasourceSettings: true,
          runQueries: true,
          publishFeatures: true,
          manageEnvironments: true,
          runExperiments: true,
        },
      },
      projects: {
        prj_exl5jr5dl4rbw856: {
          environments: [],
          limitAccessByEnvironment: false,
          permissions: {
            createPresentations: true,
            createDimensions: false,
            createSegments: false,
            organizationSettings: false,
            superDelete: false,
            manageTeam: false,
            manageTags: true,
            manageApiKeys: false,
            manageIntegrations: false,
            manageArchetype: true,
            manageFactTables: false,
            manageWebhooks: false,
            manageBilling: false,
            manageNorthStarMetric: false,
            manageTargetingAttributes: true,
            manageNamespaces: true,
            manageSavedGroups: true,
            viewEvents: false,
            addComments: true,
            createFeatureDrafts: true,
            manageFeatures: true,
            manageProjects: false,
            createAnalyses: false,
            createIdeas: true,
            createMetrics: false,
            createDatasources: false,
            editDatasourceSettings: false,
            runQueries: false,
            publishFeatures: true,
            manageEnvironments: true,
            runExperiments: true,
          },
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
            environments: ["production", "staging"],
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
                environments: ["dev"],
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
        permissions: {
          createPresentations: true,
          createDimensions: true,
          createSegments: true,
          organizationSettings: false,
          superDelete: false,
          manageTeam: false,
          manageTags: true,
          manageApiKeys: false,
          manageIntegrations: false,
          manageWebhooks: false,
          manageBilling: false,
          manageNorthStarMetric: false,
          manageTargetingAttributes: true,
          manageNamespaces: true,
          manageSavedGroups: true,
          viewEvents: false,
          addComments: true,
          createFeatureDrafts: true,
          manageFeatures: true,
          manageProjects: false,
          manageArchetype: true,
          manageFactTables: true,
          createAnalyses: true,
          createIdeas: true,
          createMetrics: true,
          createDatasources: false,
          editDatasourceSettings: true,
          runQueries: true,
          publishFeatures: true,
          manageEnvironments: true,
          runExperiments: true,
        },
      },
      projects: {
        prj_exl5jr5dl4rbw856: {
          environments: ["dev", "production", "staging"],
          limitAccessByEnvironment: true,
          permissions: {
            createPresentations: true,
            createDimensions: false,
            createSegments: false,
            organizationSettings: false,
            superDelete: false,
            manageTeam: false,
            manageTags: true,
            manageApiKeys: false,
            manageIntegrations: false,
            manageWebhooks: false,
            manageBilling: false,
            manageNorthStarMetric: false,
            manageArchetype: true,
            manageFactTables: false,
            manageTargetingAttributes: true,
            manageNamespaces: true,
            manageSavedGroups: true,
            viewEvents: false,
            addComments: true,
            createFeatureDrafts: true,
            manageFeatures: true,
            manageProjects: false,
            createAnalyses: false,
            createIdeas: true,
            createMetrics: false,
            createDatasources: false,
            editDatasourceSettings: false,
            runQueries: false,
            publishFeatures: true,
            manageEnvironments: true,
            runExperiments: true,
          },
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
        permissions: {
          createPresentations: true,
          createDimensions: false,
          createSegments: false,
          organizationSettings: false,
          superDelete: false,
          manageTeam: false,
          manageTags: true,
          manageApiKeys: false,
          manageIntegrations: false,
          manageArchetype: true,
          manageFactTables: false,
          manageWebhooks: false,
          manageBilling: false,
          manageNorthStarMetric: false,
          manageTargetingAttributes: true,
          manageNamespaces: true,
          manageSavedGroups: true,
          viewEvents: false,
          addComments: true,
          createFeatureDrafts: true,
          manageFeatures: true,
          manageProjects: false,
          createAnalyses: false,
          createIdeas: true,
          createMetrics: false,
          createDatasources: false,
          editDatasourceSettings: false,
          runQueries: false,
          publishFeatures: true,
          manageEnvironments: true,
          runExperiments: true,
        },
      },
      projects: {
        prj_exl5jr5dl4rbw856: {
          environments: [],
          limitAccessByEnvironment: false,
          permissions: {
            createPresentations: false,
            createDimensions: false,
            createSegments: false,
            organizationSettings: false,
            superDelete: false,
            manageTeam: false,
            manageTags: false,
            manageApiKeys: false,
            manageIntegrations: false,
            manageWebhooks: false,
            manageBilling: false,
            manageNorthStarMetric: false,
            manageTargetingAttributes: false,
            manageNamespaces: false,
            manageArchetype: false,
            manageFactTables: false,
            manageSavedGroups: false,
            viewEvents: false,
            addComments: false,
            createFeatureDrafts: false,
            manageFeatures: false,
            manageProjects: false,
            createAnalyses: false,
            createIdeas: false,
            createMetrics: false,
            createDatasources: false,
            editDatasourceSettings: false,
            runQueries: false,
            publishFeatures: false,
            manageEnvironments: false,
            runExperiments: false,
          },
        },
      },
    });
  });
});
