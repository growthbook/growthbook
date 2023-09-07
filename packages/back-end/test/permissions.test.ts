import { getUserPermissions } from "../src/util/organization.util";
import { OrganizationInterface } from "../types/organization";
import { findTeamById } from "../src/models/TeamModel";

jest.mock("../src/models/TeamModel", () => ({
  findTeamById: jest.fn(),
}));

describe("Build user permissions", () => {
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
  it("should handle a basic readonly user with no project-level permissions or teams correctly", async () => {
    const userPermissions = await getUserPermissions("base_user_123", testOrg);
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

  it("should handle a basic collaborator user with no project-level permissions or teams correctly", async () => {
    const userPermissions = await getUserPermissions("base_user_123", {
      ...testOrg,
      members: [{ ...testOrg.members[0], role: "collaborator" }],
    });
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

  it("should handle a basic engineer user with no project-level permissions or teams correctly", async () => {
    const userPermissions = await getUserPermissions("base_user_123", {
      ...testOrg,
      members: [{ ...testOrg.members[0], role: "engineer" }],
    });
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

  it("should handle a basic analyst user with no project-level permissions or teams correctly", async () => {
    const userPermissions = await getUserPermissions("base_user_123", {
      ...testOrg,
      members: [{ ...testOrg.members[0], role: "analyst" }],
    });
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

  it("should handle a basic experimenter user with no project-level permissions or teams correctly", async () => {
    const userPermissions = await getUserPermissions("base_user_123", {
      ...testOrg,
      members: [{ ...testOrg.members[0], role: "experimenter" }],
    });
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

  it("should handle an admin user with no project-level permissions or teams correctly", async () => {
    const userPermissions = await getUserPermissions("base_user_123", {
      ...testOrg,
      members: [{ ...testOrg.members[0], role: "admin" }],
    });
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
  it("should handle a readonly user with a single engineer project-level permission and no teams correctly", async () => {
    const userPermissions = await getUserPermissions("base_user_123", {
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
    });

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

  it("should handle a readonly user with  multiple project-level permissions and no teams correctly", async () => {
    const userPermissions = await getUserPermissions("base_user_123", {
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
    });

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

  it("should handle an engineer user with environment specific permissions correctly", async () => {
    const userPermissions = await getUserPermissions("base_user_123", {
      ...testOrg,
      members: [
        {
          ...testOrg.members[0],
          role: "engineer",
          environments: ["staging", "development"],
          limitAccessByEnvironment: true,
        },
      ],
    });

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

  it("should handle an engineer user with environment specific permissions and project-level roles that have environment specific permissions correctly", async () => {
    const userPermissions = await getUserPermissions("base_user_123", {
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
    });

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
  it("should handle a readonly user with no environment specific permissions and project-level roles that have environment specific permissions correctly where the user is on a team that has collaborator permissions", async () => {
    (findTeamById as jest.Mock).mockResolvedValue({
      id: "team_collaborators",
      role: "collaborator",
      limitAccessByEnvironment: false,
      environments: [],
      projectRoles: [],
    });

    const userPermissions = await getUserPermissions("base_user_123", {
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
          teams: ["team_collaborators"],
        },
      ],
    });

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

  it("shouldn't override a user's global permissions with a team's permissions if the user has a more permissive role", async () => {
    (findTeamById as jest.Mock).mockResolvedValue({
      id: "team_collaborators",
      role: "collaborator",
      limitAccessByEnvironment: false,
      environments: [],
      projectRoles: [],
    });

    const userPermissions = await getUserPermissions("base_user_123", {
      ...testOrg,
      members: [
        {
          ...testOrg.members[0],
          role: "admin",
        },
      ],
    });

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

  it("should handle a basic engineer user with no environment specific permissions and project-level roles that have environment specific permissions correctly where the user is on a team that has engineer permissions", async () => {
    (findTeamById as jest.Mock).mockResolvedValue({
      id: "team_engineers",
      role: "engineer",
      limitAccessByEnvironment: true,
      environments: ["staging", "development"],
      projectRoles: [],
    });

    const userPermissions = await getUserPermissions("base_user_123", {
      ...testOrg,
      members: [
        {
          ...testOrg.members[0],
          role: "engineer",
          limitAccessByEnvironment: true,
          environments: ["production"],
          projectRoles: [],
          teams: ["team_engineers"],
        },
      ],
    });

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

  it("should handle a readonly user that has project specific engineer permissions, with specific environment permissions,and is on a team that also has engineering permissions, but no environment limits", async () => {
    (findTeamById as jest.Mock).mockResolvedValue({
      id: "team_readonly_advanced",
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
    });

    const userPermissions = await getUserPermissions("base_user_123", {
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
          teams: ["team_engineers"],
        },
      ],
    });

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

  // Build test case where base user is admin, but they're on a readonly team, ensure we don't override their admin permissions
  it("should not override a user's global permissions with a team's permissions if the user has a more permissive role", async () => {
    (findTeamById as jest.Mock).mockResolvedValue({
      id: "team_readonly",
      role: "readonly",
      limitAccessByEnvironment: false,
      environments: [],
      projectRoles: [],
    });

    const userPermissions = await getUserPermissions("base_user_123", {
      ...testOrg,
      members: [
        {
          ...testOrg.members[0],
          role: "admin",
        },
      ],
    });

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

  // Build the test case where the base user is a collaborator, but they're on an engineering team with env specific limits, ensure the permissions are correct as are the env specific limits
  it("should update global permissions if team role is more permissive than user global role", async () => {
    (findTeamById as jest.Mock).mockResolvedValue({
      id: "team_engineer",
      role: "engineer",
      limitAccessByEnvironment: true,
      environments: ["staging", "production"],
      projectRoles: [],
    });

    const userPermissions = await getUserPermissions("base_user_123", {
      ...testOrg,
      members: [
        {
          ...testOrg.members[0],
          role: "collaborator",
          teams: ["engineer_team"],
        },
      ],
    });

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

  // Build the test case where the base user is an admin, and they're on a team that has engineering roles with env specific limits, ensure the env specific limits don't get applied to the admin user's permission
  it("should not override a user's global permissions env level permissions with a team's permissions if the user has a more permissive role", async () => {
    (findTeamById as jest.Mock).mockResolvedValue({
      id: "team_engineer",
      role: "engineer",
      limitAccessByEnvironment: true,
      environments: ["staging", "production"],
      projectRoles: [],
    });

    const userPermissions = await getUserPermissions("base_user_123", {
      ...testOrg,
      members: [
        {
          ...testOrg.members[0],
          role: "admin",
        },
      ],
    });

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
    (findTeamById as jest.Mock).mockResolvedValue({
      id: "team_engineer",
      role: "engineer",
      limitAccessByEnvironment: true,
      environments: ["staging", "production"],
      projectRoles: [],
    });

    const userPermissions = await getUserPermissions("base_user_123", {
      ...testOrg,
      members: [
        {
          ...testOrg.members[0],
          role: "experimenter",
          teams: ["engineering_team"],
        },
      ],
    });

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
    (findTeamById as jest.Mock).mockResolvedValue({
      id: "team_experimenter",
      role: "experimenter",
      limitAccessByEnvironment: true,
      environments: ["staging", "development"],
      projectRoles: [],
    });

    const userPermissions = await getUserPermissions("base_user_123", {
      ...testOrg,
      members: [
        {
          ...testOrg.members[0],
          role: "engineer",
          limitAccessByEnvironment: true,
          environments: ["production"],
          teams: ["team_experimenter"],
        },
      ],
    });

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
});
