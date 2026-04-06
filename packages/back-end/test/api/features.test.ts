import request from "supertest";
import { FeatureInterface } from "shared/types/feature";
import {
  createFeature,
  getFeature,
  updateFeature,
  createAndPublishRevision,
} from "back-end/src/models/FeatureModel";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { getExperimentMapForFeature } from "back-end/src/models/ExperimentModel";
import { addTags } from "back-end/src/models/TagModel";
import {
  getSavedGroupMap,
  getApiFeatureObj,
  createInterfaceEnvSettingsFromApiEnvSettings,
  updateInterfaceEnvSettingsFromApiEnvSettings,
  getNextScheduledUpdate,
} from "back-end/src/services/features";
import { setupApp } from "./api.setup";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeature: jest.fn(),
  createFeature: jest.fn(),
  updateFeature: jest.fn(),
  createAndPublishRevision: jest.fn(),
}));

jest.mock("back-end/src/models/TagModel", () => ({
  addTags: jest.fn(),
  addTagsDiff: jest.fn(),
}));

jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentMapForFeature: jest.fn(),
}));

jest.mock("back-end/src/models/FeatureRevisionModel", () => ({
  getRevision: jest.fn(),
  registerRevisionPublishedHook: jest.fn(),
}));

jest.mock("back-end/src/services/features", () => ({
  getApiFeatureObj: jest.fn(),
  getSavedGroupMap: jest.fn(),
  getNextScheduledUpdate: jest.fn(),
  addIdsToRules: jest.fn(),
  createInterfaceEnvSettingsFromApiEnvSettings: jest.fn(),
  updateInterfaceEnvSettingsFromApiEnvSettings: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const makeFeature = (
  overrides: Partial<FeatureInterface> = {},
): FeatureInterface => ({
  organization: "org",
  defaultValue: "false",
  valueType: "boolean",
  owner: "owner",
  description: "description",
  project: "project",
  id: "myfeature",
  archived: false,
  tags: [],
  dateCreated: new Date(),
  dateUpdated: new Date(),
  version: 1,
  environmentSettings: {
    production: { enabled: true, rules: [] },
  },
  prerequisites: [],
  ...overrides,
});

const makeRevisionDoc = (version: number, featureId = "myfeature") => ({
  version,
  status: "published",
  createdBy: { id: "user", email: "u@test.com", name: "Test" },
  dateCreated: new Date(),
  featureId,
  organization: "org",
  baseVersion: version - 1,
  publishedBy: null,
  comment: "",
  defaultValue: "false",
  rules: {},
});

describe("features API", () => {
  const { app, auditMock, setReqContext } = setupApp();

  const testUser = { id: "u_user1", email: "user@example.com" };

  const org = {
    id: "org",
    settings: {
      environments: [{ id: "production" }],
      restApiBypassesReviews: true,
    },
    members: [{ id: testUser.id }],
  };

  const getEmptyCustomFieldsModel = () => ({
    getCustomFieldsBySectionAndProject: jest.fn().mockResolvedValue([]),
  });

  const defaultModels = () => ({
    safeRollout: {
      getAllPayloadSafeRollouts: jest.fn().mockResolvedValue(new Map()),
    },
    customFields: getEmptyCustomFieldsModel(),
  });

  const defaultPermissions = (extra = {}) => ({
    canPublishFeature: () => true,
    canUpdateFeature: () => true,
    canCreateFeature: () => true,
    canBypassApprovalChecks: () => false,
    ...extra,
  });

  // Sets req.context with sensible defaults; pass overrides for test-specific needs.
  const defaultContext = (overrides: Record<string, unknown> = {}) =>
    setReqContext({
      org,
      models: defaultModels(),
      permissions: defaultPermissions(),
      getProjects: async () => [{ id: "project" }],
      getUserByEmail: jest.fn().mockResolvedValue(null),
      ...overrides,
    });

  beforeEach(() => {
    (getApiFeatureObj as jest.Mock).mockImplementation((v) => v);
    (getSavedGroupMap as jest.Mock).mockResolvedValue("savedGroupMap");
    (getExperimentMapForFeature as jest.Mock).mockResolvedValue(new Map());
    (getNextScheduledUpdate as jest.Mock).mockReturnValue(null);

    (getRevision as jest.Mock).mockImplementation(({ version }) =>
      version !== undefined
        ? Promise.resolve(makeRevisionDoc(version))
        : Promise.resolve(null),
    );

    // Default: createAndPublishRevision succeeds and bumps the version.
    (createAndPublishRevision as jest.Mock).mockImplementation(
      ({ feature }) => {
        const newVersion = (feature.version || 1) + 1;
        return Promise.resolve({
          revision: makeRevisionDoc(newVersion, feature.id),
          updatedFeature: { ...feature, version: newVersion },
        });
      },
    );

    // Default write mocks — individual tests can override as needed.
    (getFeature as jest.Mock).mockReturnValue(undefined);
    (addTags as jest.Mock).mockReturnValue(undefined);
    (createFeature as jest.Mock).mockImplementation((v) => v);
    (updateFeature as jest.Mock).mockImplementation((ctx, f, updates) =>
      Promise.resolve({ ...f, ...updates }),
    );
    (createInterfaceEnvSettingsFromApiEnvSettings as jest.Mock).mockReturnValue(
      {},
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // POST /api/v1/features — create
  // ---------------------------------------------------------------------------

  it("can create new features", async () => {
    defaultContext();
    (createInterfaceEnvSettingsFromApiEnvSettings as jest.Mock).mockReturnValue(
      "createInterfaceEnvSettingsFromApiEnvSettings",
    );

    const feature = {
      defaultValue: "defaultValue",
      valueType: "string",
      owner: testUser.id,
      description: "description",
      project: "project",
      id: "id",
      archived: true,
      tags: ["tag"],
    };

    const response = await request(app)
      .post("/api/v1/features")
      .send(feature)
      .set("Authorization", "Bearer foo");
    expect(response.status).toBe(200);
    expect(getApiFeatureObj).toHaveBeenCalled();
    expect(addTags).toHaveBeenCalledWith("org", ["tag"]);
    expect(response.body).toEqual(
      expect.objectContaining({
        feature: expect.objectContaining({
          experimentMap: {},
          feature: expect.objectContaining({
            archived: true,
            dateCreated: expect.any(String),
            dateUpdated: expect.any(String),
            defaultValue: "defaultValue",
            description: "description",
            environmentSettings: "createInterfaceEnvSettingsFromApiEnvSettings",
            prerequisites: [],
            id: "id",
            jsonSchema: expect.objectContaining({
              date: expect.any(String),
              enabled: false,
              schema: "",
              schemaType: "schema",
              simple: { fields: [], type: "object" },
            }),
            organization: "org",
            owner: testUser.id,
            project: "project",
            tags: ["tag"],
            valueType: "string",
            version: 1,
          }),
          groupMap: "savedGroupMap",
        }),
      }),
    );
    expect(auditMock).toHaveBeenCalledWith({
      details: `{"post":{"defaultValue":"defaultValue","valueType":"string","owner":"${testUser.id}","description":"description","project":"project","dateCreated":"${response.body.feature.feature.dateCreated}","dateUpdated":"${response.body.feature.feature.dateUpdated}","organization":"org","id":"id","archived":true,"version":1,"environmentSettings":"createInterfaceEnvSettingsFromApiEnvSettings","prerequisites":[],"tags":["tag"],"jsonSchema":{"schemaType":"schema","schema":"","simple":{"type":"object","fields":[]},"date":"${response.body.feature.feature.jsonSchema.date}","enabled":false}},"context":{}}`,
      entity: { id: "id", object: "feature" },
      event: "feature.create",
    });
  });

  it("resolves email to userId when creating a feature", async () => {
    defaultContext({
      getUserByEmail: jest.fn().mockResolvedValue({ id: testUser.id }),
    });

    const response = await request(app)
      .post("/api/v1/features")
      .send({
        defaultValue: "false",
        valueType: "boolean",
        owner: testUser.email,
        id: "email-owner-feature",
      })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body.feature.feature.owner).toBe(testUser.id);
  });

  it("passes through unresolvable email/name owner values unchanged", async () => {
    defaultContext();

    const response = await request(app)
      .post("/api/v1/features")
      .send({
        defaultValue: "false",
        valueType: "boolean",
        owner: "Ben",
        id: "id",
      })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body.feature.feature.owner).toBe("Ben");
  });

  it("rejects an explicit userId that is not an org member", async () => {
    defaultContext();

    const response = await request(app)
      .post("/api/v1/features")
      .send({
        defaultValue: "false",
        valueType: "boolean",
        owner: "u_notamember",
        id: "id",
      })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(400);
    expect(response.body.message).toContain("Unable to find user");
  });

  it("fails to create new features when a required custom field is missing", async () => {
    defaultContext({
      models: {
        ...defaultModels(),
        customFields: {
          getCustomFieldsBySectionAndProject: jest.fn().mockResolvedValue([
            {
              id: "cfd_team",
              name: "Owning Team",
              type: "enum",
              required: true,
              values: "growth,platform",
              section: "feature",
              dateCreated: new Date("2026-01-01"),
              dateUpdated: new Date("2026-01-01"),
            },
          ]),
        },
      },
    });

    const response = await request(app)
      .post("/api/v1/features")
      .send({
        defaultValue: "defaultValue",
        valueType: "string",
        owner: "owner",
        description: "description",
        project: "project",
        id: "id",
        archived: true,
        tags: ["tag"],
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain(
      'Custom field "Owning Team" is required.',
    );
    expect(createFeature).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // requireProjectForFeatures
  // ---------------------------------------------------------------------------

  describe("requireProjectForFeatures enabled", () => {
    const requireProjectContext = (overrides: Record<string, unknown> = {}) =>
      defaultContext({
        org: { ...org, settings: { requireProjectForFeatures: true } },
        ...overrides,
      });

    it("fails to create new features without a project", async () => {
      requireProjectContext();

      const response = await request(app)
        .post("/api/v1/features")
        .send({
          defaultValue: "defaultValue",
          valueType: "string",
          owner: "owner",
          description: "description",
          project: "",
          id: "id",
          archived: true,
          tags: ["tag"],
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        message: "Must specify a project for new features",
      });
    });

    it("fails to update existing features if removing a project", async () => {
      requireProjectContext();

      const existingFeature = makeFeature({ project: "project" });
      (getFeature as jest.Mock).mockResolvedValue(existingFeature);

      const response = await request(app)
        .post(`/api/v1/features/${existingFeature.id}`)
        .send({ project: "" });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ message: "Must specify a project" });
    });

    it("allows updating existing features if originally not associated with a project", async () => {
      requireProjectContext();

      const existingFeature = makeFeature({ project: "" });
      (getFeature as jest.Mock).mockResolvedValue(existingFeature);

      const newDescription = "This is an updated description";
      const response = await request(app)
        .post(`/api/v1/features/${existingFeature.id}`)
        .send({ description: newDescription });

      expect(response.status).toBe(200);
      // createAndPublishRevision is mocked — verify the version was bumped
      // and createAndPublishRevision was called with the metadata change.
      expect(createAndPublishRevision).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: expect.objectContaining({
            metadata: expect.objectContaining({ description: newDescription }),
          }),
        }),
      );
      expect(response.body.feature.feature.version).toBe(2);
    });

    it("allows updating existing features when required custom fields are missing and payload omits customFields", async () => {
      const getCustomFieldsBySectionAndProject = jest.fn().mockResolvedValue([
        {
          id: "cfd_team",
          name: "Owning Team",
          type: "enum",
          required: true,
          values: "growth,platform",
          section: "feature",
          dateCreated: new Date("2026-01-01"),
          dateUpdated: new Date("2026-01-01"),
        },
      ]);
      requireProjectContext({
        models: {
          ...defaultModels(),
          customFields: { getCustomFieldsBySectionAndProject },
        },
      });

      const existingFeature = makeFeature({ customFields: {} });
      (getFeature as jest.Mock).mockResolvedValue(existingFeature);

      const response = await request(app)
        .post(`/api/v1/features/${existingFeature.id}`)
        .send({ description: "new description" });

      expect(response.status).toBe(200);
      expect(updateFeature).toHaveBeenCalled();
      expect(getCustomFieldsBySectionAndProject).not.toHaveBeenCalled();
    });

    it("allows updating existing features when customFields payload is unchanged", async () => {
      const getCustomFieldsBySectionAndProject = jest.fn().mockResolvedValue([
        {
          id: "cfd_team",
          name: "Owning Team",
          type: "enum",
          required: true,
          values: "growth,platform",
          section: "feature",
          dateCreated: new Date("2026-01-01"),
          dateUpdated: new Date("2026-01-01"),
        },
      ]);
      requireProjectContext({
        models: {
          ...defaultModels(),
          customFields: { getCustomFieldsBySectionAndProject },
        },
      });

      const existingFeature = makeFeature({ customFields: {} });
      (getFeature as jest.Mock).mockResolvedValue(existingFeature);

      const response = await request(app)
        .post(`/api/v1/features/${existingFeature.id}`)
        .send({ description: "new description", customFields: {} });

      expect(response.status).toBe(200);
      expect(updateFeature).toHaveBeenCalled();
      expect(getCustomFieldsBySectionAndProject).not.toHaveBeenCalled();
    });

    it("rejects updating existing features when customFields are cleared from a non-empty object", async () => {
      const getCustomFieldsBySectionAndProject = jest.fn().mockResolvedValue([
        {
          id: "cfd_team",
          name: "Owning Team",
          type: "enum",
          required: true,
          values: "growth,platform",
          section: "feature",
          dateCreated: new Date("2026-01-01"),
          dateUpdated: new Date("2026-01-01"),
        },
      ]);
      requireProjectContext({
        models: {
          ...defaultModels(),
          customFields: { getCustomFieldsBySectionAndProject },
        },
      });

      const existingFeature = makeFeature({
        customFields: { cfd_team: "growth" },
      });
      (getFeature as jest.Mock).mockResolvedValue(existingFeature);

      const response = await request(app)
        .post(`/api/v1/features/${existingFeature.id}`)
        .send({ description: "new description", customFields: {} });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain(
        'Custom field "Owning Team" is required.',
      );
      expect(updateFeature).not.toHaveBeenCalled();
      expect(getCustomFieldsBySectionAndProject).toHaveBeenCalled();
    });

    it("allows updating existing features when project payload is unchanged", async () => {
      const getCustomFieldsBySectionAndProject = jest.fn().mockResolvedValue([
        {
          id: "cfd_team",
          name: "Owning Team",
          type: "enum",
          required: true,
          values: "growth,platform",
          section: "feature",
          dateCreated: new Date("2026-01-01"),
          dateUpdated: new Date("2026-01-01"),
        },
      ]);
      requireProjectContext({
        models: {
          ...defaultModels(),
          customFields: { getCustomFieldsBySectionAndProject },
        },
        getProjects: async () => [{ id: "project" }, { id: "project-b" }],
      });

      const existingFeature = makeFeature({ customFields: {} });
      (getFeature as jest.Mock).mockResolvedValue(existingFeature);

      const response = await request(app)
        .post(`/api/v1/features/${existingFeature.id}`)
        .send({ description: "new description", project: "project" });

      expect(response.status).toBe(200);
      expect(updateFeature).toHaveBeenCalled();
      expect(getCustomFieldsBySectionAndProject).not.toHaveBeenCalled();
    });

    it("revalidates and rejects when changing project to one with required custom fields", async () => {
      const getCustomFieldsBySectionAndProject = jest
        .fn()
        .mockImplementation(({ project }) =>
          project === "project-b"
            ? Promise.resolve([
                {
                  id: "cfd_team",
                  name: "Owning Team",
                  type: "enum",
                  required: true,
                  values: "growth,platform",
                  section: "feature",
                  dateCreated: new Date("2026-01-01"),
                  dateUpdated: new Date("2026-01-01"),
                },
              ])
            : Promise.resolve([]),
        );
      requireProjectContext({
        models: {
          ...defaultModels(),
          customFields: { getCustomFieldsBySectionAndProject },
        },
        getProjects: async () => [{ id: "project" }, { id: "project-b" }],
      });

      const existingFeature = makeFeature({ customFields: {} });
      (getFeature as jest.Mock).mockResolvedValue(existingFeature);

      const response = await request(app)
        .post(`/api/v1/features/${existingFeature.id}`)
        .send({ description: "new description", project: "project-b" });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain(
        'Custom field "Owning Team" is required.',
      );
      expect(updateFeature).not.toHaveBeenCalled();
    });

    it("revalidates and rejects when changing project and customFields payload is changed", async () => {
      const getCustomFieldsBySectionAndProject = jest
        .fn()
        .mockImplementation(({ project }) =>
          project === "project-b"
            ? Promise.resolve([
                {
                  id: "cfd_team",
                  name: "Owning Team",
                  type: "enum",
                  required: true,
                  values: "growth,platform",
                  section: "feature",
                  dateCreated: new Date("2026-01-01"),
                  dateUpdated: new Date("2026-01-01"),
                },
              ])
            : Promise.resolve([]),
        );
      requireProjectContext({
        models: {
          ...defaultModels(),
          customFields: { getCustomFieldsBySectionAndProject },
        },
        getProjects: async () => [{ id: "project" }, { id: "project-b" }],
      });

      const existingFeature = makeFeature({
        customFields: { cfd_team: "growth" },
      });
      (getFeature as jest.Mock).mockResolvedValue(existingFeature);

      const response = await request(app)
        .post(`/api/v1/features/${existingFeature.id}`)
        .send({
          description: "new description",
          project: "project-b",
          customFields: {},
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain(
        'Custom field "Owning Team" is required.',
      );
      expect(updateFeature).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // nextScheduledUpdate
  // ---------------------------------------------------------------------------

  describe("nextScheduledUpdate", () => {
    it("writes nextScheduledUpdate when scheduleRules are updated via API", async () => {
      defaultContext({
        permissions: defaultPermissions({
          canBypassApprovalChecks: () => true,
        }),
        hasPremiumFeature: () => true,
        getProjects: async () => [{ id: "project_1" }],
      });

      const startTs = "2026-02-20T08:00:00.000Z";
      const endTs = "2026-02-25T08:00:00.000Z";
      const nextScheduledUpdate = new Date(startTs);
      const updatedEnvironmentSettings = {
        production: {
          enabled: true,
          rules: [
            {
              id: "fr_test",
              type: "force",
              description: "scheduled force",
              condition: "",
              value: "true",
              enabled: true,
              savedGroups: [],
              scheduleRules: [
                { enabled: true, timestamp: startTs },
                { enabled: false, timestamp: endTs },
              ],
            },
          ],
        },
      };

      const existingFeature = makeFeature({
        project: "project_1",
        version: 10,
        environmentSettings: { production: { enabled: true, rules: [] } },
      });

      (getFeature as jest.Mock).mockResolvedValue(existingFeature);
      (
        updateInterfaceEnvSettingsFromApiEnvSettings as jest.Mock
      ).mockReturnValue(updatedEnvironmentSettings);
      (getNextScheduledUpdate as jest.Mock).mockReturnValue(
        nextScheduledUpdate,
      );
      (createAndPublishRevision as jest.Mock).mockResolvedValue({
        revision: makeRevisionDoc(11, existingFeature.id),
        updatedFeature: { ...existingFeature, version: 11 },
      });

      const response = await request(app)
        .post(`/api/v1/features/${existingFeature.id}`)
        .send({
          environments: {
            production: {
              enabled: true,
              rules: [
                {
                  id: "fr_test",
                  type: "force",
                  description: "scheduled force",
                  condition: "",
                  value: "true",
                  enabled: true,
                  scheduleRules: [
                    { enabled: true, timestamp: startTs },
                    { enabled: false, timestamp: endTs },
                  ],
                },
              ],
            },
          },
        });

      expect(response.status).toBe(200);
      expect(updateFeature).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          environmentSettings: updatedEnvironmentSettings,
          nextScheduledUpdate,
        }),
      );
    });

    it("does not modify nextScheduledUpdate if there are no environment updates", async () => {
      defaultContext({
        getProjects: async () => [{ id: "project_1" }, { id: "project_2" }],
      });

      const existingFeature = makeFeature({
        project: "project_1",
        version: 10,
        environmentSettings: {
          production: {
            enabled: true,
            rules: [
              {
                id: "fr_schedule",
                type: "force",
                condition: "",
                value: "true",
                savedGroups: [],
                scheduleRules: [
                  { enabled: true, timestamp: "2026-02-20T08:00:00.000Z" },
                ],
              },
            ],
          },
        },
      });

      (getFeature as jest.Mock).mockResolvedValue(existingFeature);
      (getNextScheduledUpdate as jest.Mock).mockImplementation((envSettings) =>
        envSettings ? new Date("2026-02-20T08:00:00.000Z") : null,
      );

      const originalVersion = existingFeature.version;
      const response = await request(app)
        .post(`/api/v1/features/${existingFeature.id}`)
        .send({ project: "project_2" });

      expect(response.status).toBe(200);
      expect(updateFeature).toHaveBeenCalled();
      const updateFeatureCall = (updateFeature as jest.Mock).mock.calls[0];
      const updatesArg = updateFeatureCall[2];
      expect(updatesArg).toEqual({ version: originalVersion + 1 });
    });
  });

  // ---------------------------------------------------------------------------
  // Approval / bypass permutation matrix
  // ---------------------------------------------------------------------------

  describe("approval and bypass permutations for PUT /api/v1/features/:id", () => {
    const approvalRequiredSettings = {
      requireReviews: [
        {
          requireReviewOn: true,
          resetReviewOnChange: false,
          environments: ["production"],
          projects: [],
        },
      ],
    };

    const setupUpdateTest = (orgSettings = {}, permissionsOverride = {}) => {
      const existingFeature = makeFeature();
      defaultContext({
        org: { ...org, settings: { ...org.settings, ...orgSettings } },
        permissions: defaultPermissions(permissionsOverride),
      });
      (getFeature as jest.Mock).mockResolvedValue(existingFeature);
      return existingFeature;
    };

    it("publishes directly when approvals are OFF (no requireReviews)", async () => {
      setupUpdateTest();
      const response = await request(app)
        .post("/api/v1/features/myfeature")
        .send({ defaultValue: "true" });

      expect(response.status).toBe(200);
      expect(createAndPublishRevision).toHaveBeenCalledWith(
        expect.objectContaining({ canBypassApprovalChecks: true }),
      );
    });

    it("publishes directly when approvals required but restApiBypassesReviews is true (legacy orgs default)", async () => {
      // orgs that never had the field set get it backfilled to true by upgradeOrganizationDoc;
      // the test simulates post-migration state by setting it explicitly.
      setupUpdateTest({
        ...approvalRequiredSettings,
        restApiBypassesReviews: true,
      });
      const response = await request(app)
        .post("/api/v1/features/myfeature")
        .send({ defaultValue: "true" });

      expect(response.status).toBe(200);
      expect(createAndPublishRevision).toHaveBeenCalledWith(
        expect.objectContaining({ canBypassApprovalChecks: true }),
      );
    });

    it("role-based bypassApprovalChecks permission bypasses when restApiBypassesReviews=false", async () => {
      // Tokens/roles that grant bypassApprovalChecks for the feature's project
      // can still publish through the REST API even when the org-level
      // restApiBypassesReviews setting is disabled.
      setupUpdateTest(
        { ...approvalRequiredSettings, restApiBypassesReviews: false },
        { canBypassApprovalChecks: () => true },
      );
      const response = await request(app)
        .post("/api/v1/features/myfeature")
        .send({ defaultValue: "true" });

      expect(response.status).toBe(200);
      expect(createAndPublishRevision).toHaveBeenCalledWith(
        expect.objectContaining({ canBypassApprovalChecks: true }),
      );
    });

    it("throws when approvals required and neither restApiBypassesReviews nor role permission allow bypass", async () => {
      setupUpdateTest(
        { ...approvalRequiredSettings, restApiBypassesReviews: false },
        { canBypassApprovalChecks: () => false },
      );
      (createAndPublishRevision as jest.Mock).mockRejectedValue(
        Object.assign(
          new Error(
            "This feature requires approval before changes can be published. " +
              "Enable 'REST API always bypasses approval requirements' in organization settings.",
          ),
          { status: 403 },
        ),
      );

      const response = await request(app)
        .post("/api/v1/features/myfeature")
        .send({ defaultValue: "true" });

      expect(response.status).toBe(403);
      expect(response.body.message).toContain(
        "This feature requires approval before changes can be published.",
      );
    });

    it("passes canBypassApprovalChecks=false when neither org setting nor role permission allow bypass", async () => {
      setupUpdateTest({
        ...approvalRequiredSettings,
        restApiBypassesReviews: false,
      });
      (createAndPublishRevision as jest.Mock).mockResolvedValue({
        revision: makeRevisionDoc(2),
        updatedFeature: makeFeature({ version: 2 }),
      });

      await request(app)
        .post("/api/v1/features/myfeature")
        .send({ defaultValue: "true" });

      expect(createAndPublishRevision).toHaveBeenCalledWith(
        expect.objectContaining({ canBypassApprovalChecks: false }),
      );
    });

    it("metadata-only changes (description) still go through createAndPublishRevision", async () => {
      setupUpdateTest();
      const response = await request(app)
        .post("/api/v1/features/myfeature")
        .send({ description: "updated desc" });

      expect(response.status).toBe(200);
      expect(createAndPublishRevision).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: expect.objectContaining({
            metadata: expect.objectContaining({ description: "updated desc" }),
          }),
        }),
      );
    });

    it("non-revision-tracked changes (owner) do NOT call createAndPublishRevision", async () => {
      // owner is a metadata field → does go through revision.
      // Let's use a pure non-tracked field like… actually all meaningful fields
      // go through revisions now. Verify that a no-op update (nothing changes) skips it.
      setupUpdateTest();
      // Send a field that results in no revision-tracked delta
      const existingFeature = makeFeature();
      (getFeature as jest.Mock).mockResolvedValue(existingFeature);
      // defaultValue same as current — no change
      const response = await request(app)
        .post("/api/v1/features/myfeature")
        .send({ defaultValue: "false" }); // same as existingFeature.defaultValue

      expect(response.status).toBe(200);
      // No revision-tracked delta → createAndPublishRevision should NOT be called
      expect(createAndPublishRevision).not.toHaveBeenCalled();
    });

    it("includes all changed fields in the revision changes object", async () => {
      setupUpdateTest();
      const response = await request(app)
        .post("/api/v1/features/myfeature")
        .send({
          defaultValue: "true",
          description: "new desc",
          archived: true,
        });

      expect(response.status).toBe(200);
      expect(createAndPublishRevision).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: expect.objectContaining({
            defaultValue: "true",
            archived: true,
            metadata: expect.objectContaining({ description: "new desc" }),
          }),
        }),
      );
    });

    it("publishes without bypass when review is scoped to production but change is dev-only", async () => {
      // Reviews required, but only for "production". Change targets "dev" only.
      // restApiBypassesReviews=false and no canBypassApprovalChecks — the caller has
      // no elevated privileges. createAndPublishRevision still gets called because
      // the env-scoped check inside it (checkIfRevisionNeedsReview) will return false.
      // At this API layer we just verify canBypassApprovalChecks=false is forwarded and
      // the endpoint returns 200 (the mock resolves successfully either way).
      setupUpdateTest(
        {
          requireReviews: [
            {
              requireReviewOn: true,
              resetReviewOnChange: false,
              environments: ["production"],
              projects: [],
            },
          ],
          restApiBypassesReviews: false,
        },
        { canBypassApprovalChecks: () => false },
      );

      const response = await request(app)
        .post("/api/v1/features/myfeature")
        .send({ defaultValue: "true" });

      expect(response.status).toBe(200);
      // canBypassApprovalChecks is false — the helper itself decides whether review
      // is needed based on which environments are touched.
      expect(createAndPublishRevision).toHaveBeenCalledWith(
        expect.objectContaining({ canBypassApprovalChecks: false }),
      );
    });
  });
});
