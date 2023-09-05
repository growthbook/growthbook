import { getUserPermissions } from "../src/util/organization.util";
import { OrganizationInterface } from "../types/organization";

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
        id: "basic_readonly_user",
        role: "readonly",
        dateCreated: new Date(),
        limitAccessByEnvironment: false,
        environments: [],
        projectRoles: [],
        teams: [],
      },
      {
        id: "basic_collaborator_user",
        role: "collaborator",
        dateCreated: new Date(),
        limitAccessByEnvironment: false,
        environments: [],
        projectRoles: [],
        teams: [],
      },
      {
        id: "basic_engineer_user",
        role: "engineer",
        dateCreated: new Date(),
        limitAccessByEnvironment: false,
        environments: [],
        projectRoles: [],
        teams: [],
      },
      {
        id: "basic_analyst_user",
        role: "analyst",
        dateCreated: new Date(),
        limitAccessByEnvironment: false,
        environments: [],
        projectRoles: [],
        teams: [],
      },
      {
        id: "basic_experimenter_user",
        role: "experimenter",
        dateCreated: new Date(),
        limitAccessByEnvironment: false,
        environments: [],
        projectRoles: [],
        teams: [],
      },
      {
        id: "basic_admin_user",
        role: "admin",
        dateCreated: new Date(),
        limitAccessByEnvironment: false,
        environments: [],
        projectRoles: [],
        teams: [],
      },
    ],
  };

  it("should handle a basic readonly user with no project-level permissions or teams correctly", async () => {
    const userPermissions = await getUserPermissions(
      "basic_readonly_user",
      testOrg
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
    const userPermissions = await getUserPermissions(
      "basic_collaborator_user",
      testOrg
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
    const userPermissions = await getUserPermissions(
      "basic_engineer_user",
      testOrg
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
    const userPermissions = await getUserPermissions(
      "basic_analyst_user",
      testOrg
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
    const userPermissions = await getUserPermissions(
      "basic_experimenter_user",
      testOrg
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
    const userPermissions = await getUserPermissions(
      "basic_admin_user",
      testOrg
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
});
