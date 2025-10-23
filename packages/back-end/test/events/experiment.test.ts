import {
  logExperimentCreated,
  logExperimentUpdated,
  logExperimentDeleted,
  ExperimentModel,
} from "back-end/src/models/ExperimentModel";
import { getLegacyMessageForNotificationEvent } from "back-end/src/events/handlers/legacy";
import { experimentSnapshot } from "back-end/test/snapshots/experiment.snapshot";
import {
  notifyDecision,
  notifyMultipleExposures,
  notifySrm,
} from "back-end/src/services/experimentNotifications";
import { EventModel } from "back-end/src/models/EventModel";

jest.mock("back-end/src/events/notifiers/EventNotifier", () => ({
  EventNotifier: class Dummy {
    perform() {
      return undefined;
    }
  },
}));

describe("experiments events", () => {
  const org = { id: "org", environments: [{ id: "production" }] };

  afterEach(async () => {
    jest.clearAllMocks();
  });

  it("dispatches experiment.created event on experiment create", async () => {
    let rawPayload;

    jest.spyOn(EventModel, "create").mockImplementation(({ data }) => {
      rawPayload = data;
      return { toJSON: () => "" };
    });

    await logExperimentCreated(
      {
        org,
        userId: "aabb",
        email: "user@mail.com",
        userName: "User Name",
      },
      experimentSnapshot,
    );

    expect(rawPayload).toEqual(
      expect.objectContaining({
        api_version: expect.any(String),
        created: expect.any(Number),
        containsSecrets: false,
        data: expect.objectContaining({
          object: expect.objectContaining({
            archived: false,
            autoRefresh: true,
            bucketVersion: 1,
            dateCreated: expect.any(String),
            dateUpdated: expect.any(String),
            description: "",
            disableStickyBucketing: false,
            fallbackAttribute: "",
            hashAttribute: "id",
            hashVersion: 2,
            hypothesis: "",
            id: "exp_dd4gxd4lyel8bwi",
            minBucketVersion: 0,
            name: "Add To Cart",
            owner: "u_dd4g20lalsnhhp9x",
            phases: [
              {
                coverage: 1,
                dateEnded: "",
                dateStarted: "2023-07-09T15:53:00.000Z",
                name: "Main",
                namespace: undefined,
                prerequisites: [],
                reasonForStopping: "",
                savedGroupTargeting: [],
                seed: "add-cart",
                targetingCondition: "{}",
                trafficSplit: [
                  { variationId: "var_lyel8229", weight: 0.5 },
                  { variationId: "var_lyel822a", weight: 0.5 },
                ],
              },
            ],
            project: "",
            settings: {
              activationMetric: {
                metricId: "met_dd4gxd4lyel6394",
                overrides: {},
              },
              assignmentQueryId: "user_id",
              attributionModel: "firstExposure",
              datasourceId: "ds_dd4gxd4lyel5js1",
              experimentId: "add-cart",
              goals: [{ metricId: "metric-aacc", overrides: {} }],
              guardrails: [{ metricId: "metric-eeff", overrides: {} }],
              inProgressConversions: "include",
              queryFilter: "",
              regressionAdjustmentEnabled: false,
              sequentialTestingEnabled: false,
              sequentialTestingTuningParameter: 5000,
              secondaryMetrics: [{ metricId: "metric-ccdd", overrides: {} }],
              segmentId: "",
              statsEngine: "bayesian",
            },
            status: "running",
            tags: [],
            variations: [
              {
                description: "",
                key: "0",
                name: "Control",
                screenshots: [],
                variationId: "var_lyel8229",
              },
              {
                description: "",
                key: "1",
                name: "Variation 1",
                screenshots: [],
                variationId: "var_lyel822a",
              },
            ],
            shareLevel: "organization",
            trackingKey: "add-cart",
            type: "standard",
          }),
        }),
        environments: [],
        event: "experiment.created",
        object: "experiment",
        projects: [""],
        tags: [],
      }),
    );

    expect(getLegacyMessageForNotificationEvent(rawPayload)).toEqual(
      expect.objectContaining({
        containsSecrets: false,
        data: expect.objectContaining({
          current: expect.objectContaining({
            archived: false,
            autoRefresh: true,
            bucketVersion: 1,
            dateCreated: expect.any(String),
            dateUpdated: expect.any(String),
            description: "",
            disableStickyBucketing: false,
            fallbackAttribute: "",
            hashAttribute: "id",
            hashVersion: 2,
            hypothesis: "",
            id: "exp_dd4gxd4lyel8bwi",
            minBucketVersion: 0,
            name: "Add To Cart",
            owner: "u_dd4g20lalsnhhp9x",
            phases: [
              {
                coverage: 1,
                dateEnded: "",
                dateStarted: "2023-07-09T15:53:00.000Z",
                name: "Main",
                namespace: undefined,
                prerequisites: [],
                reasonForStopping: "",
                savedGroupTargeting: [],
                seed: "add-cart",
                targetingCondition: "{}",
                trafficSplit: [
                  { variationId: "var_lyel8229", weight: 0.5 },
                  { variationId: "var_lyel822a", weight: 0.5 },
                ],
              },
            ],
            project: "",
            settings: {
              activationMetric: {
                metricId: "met_dd4gxd4lyel6394",
                overrides: {},
              },
              assignmentQueryId: "user_id",
              attributionModel: "firstExposure",
              datasourceId: "ds_dd4gxd4lyel5js1",
              experimentId: "add-cart",
              goals: [{ metricId: "metric-aacc", overrides: {} }],
              guardrails: [{ metricId: "metric-eeff", overrides: {} }],
              inProgressConversions: "include",
              queryFilter: "",
              regressionAdjustmentEnabled: false,
              sequentialTestingEnabled: false,
              sequentialTestingTuningParameter: 5000,
              secondaryMetrics: [{ metricId: "metric-ccdd", overrides: {} }],
              segmentId: "",
              statsEngine: "bayesian",
            },
            status: "running",
            tags: [],
            variations: [
              {
                description: "",
                key: "0",
                name: "Control",
                screenshots: [],
                variationId: "var_lyel8229",
              },
              {
                description: "",
                key: "1",
                name: "Variation 1",
                screenshots: [],
                variationId: "var_lyel822a",
              },
            ],
            shareLevel: "organization",
            trackingKey: "add-cart",
            type: "standard",
          }),
        }),
        environments: [],
        event: "experiment.created",
        object: "experiment",
        projects: [""],
        tags: [],
        user: {
          email: "user@mail.com",
          id: "aabb",
          name: "User Name",
          type: "dashboard",
        },
      }),
    );
  });

  it("dispatches experiment.updated event on experiment update", async () => {
    let rawPayload;

    jest.spyOn(EventModel, "create").mockImplementation(({ data }) => {
      rawPayload = data;
      return { toJSON: () => "" };
    });

    await logExperimentUpdated({
      context: {
        org,
        userId: "aabb",
        email: "user@mail.com",
        userName: "User Name",
      },
      current: { ...experimentSnapshot, name: "new name" },
      previous: experimentSnapshot,
    });

    expect(rawPayload).toEqual(
      expect.objectContaining({
        api_version: expect.any(String),
        created: expect.any(Number),
        containsSecrets: false,
        data: expect.objectContaining({
          object: expect.objectContaining({
            archived: false,
            autoRefresh: true,
            bucketVersion: 1,
            dateCreated: expect.any(String),
            dateUpdated: expect.any(String),
            description: "",
            disableStickyBucketing: false,
            fallbackAttribute: "",
            hashAttribute: "id",
            hashVersion: 2,
            hypothesis: "",
            id: "exp_dd4gxd4lyel8bwi",
            minBucketVersion: 0,
            name: "new name",
            owner: "u_dd4g20lalsnhhp9x",
            phases: [
              {
                coverage: 1,
                dateEnded: "",
                dateStarted: "2023-07-09T15:53:00.000Z",
                name: "Main",
                namespace: undefined,
                prerequisites: [],
                reasonForStopping: "",
                savedGroupTargeting: [],
                seed: "add-cart",
                targetingCondition: "{}",
                trafficSplit: [
                  { variationId: "var_lyel8229", weight: 0.5 },
                  { variationId: "var_lyel822a", weight: 0.5 },
                ],
              },
            ],
            project: "",
            settings: {
              activationMetric: {
                metricId: "met_dd4gxd4lyel6394",
                overrides: {},
              },
              assignmentQueryId: "user_id",
              attributionModel: "firstExposure",
              datasourceId: "ds_dd4gxd4lyel5js1",
              experimentId: "add-cart",
              goals: [{ metricId: "metric-aacc", overrides: {} }],
              guardrails: [{ metricId: "metric-eeff", overrides: {} }],
              inProgressConversions: "include",
              queryFilter: "",
              regressionAdjustmentEnabled: false,
              sequentialTestingEnabled: false,
              sequentialTestingTuningParameter: 5000,
              secondaryMetrics: [{ metricId: "metric-ccdd", overrides: {} }],
              segmentId: "",
              statsEngine: "bayesian",
            },
            status: "running",
            tags: [],
            variations: [
              {
                description: "",
                key: "0",
                name: "Control",
                screenshots: [],
                variationId: "var_lyel8229",
              },
              {
                description: "",
                key: "1",
                name: "Variation 1",
                screenshots: [],
                variationId: "var_lyel822a",
              },
            ],
            shareLevel: "organization",
            trackingKey: "add-cart",
            type: "standard",
          }),
          previous_attributes: { name: "Add To Cart" },
        }),
        environments: [],
        event: "experiment.updated",
        object: "experiment",
        projects: [""],
        tags: [],
        user: {
          email: "user@mail.com",
          id: "aabb",
          name: "User Name",
          type: "dashboard",
        },
      }),
    );

    expect(getLegacyMessageForNotificationEvent(rawPayload)).toEqual(
      expect.objectContaining({
        containsSecrets: false,
        data: expect.objectContaining({
          current: expect.objectContaining({
            archived: false,
            autoRefresh: true,
            bucketVersion: 1,
            dateCreated: expect.any(String),
            dateUpdated: expect.any(String),
            description: "",
            disableStickyBucketing: false,
            fallbackAttribute: "",
            hashAttribute: "id",
            hashVersion: 2,
            hypothesis: "",
            id: "exp_dd4gxd4lyel8bwi",
            minBucketVersion: 0,
            name: "new name",
            owner: "u_dd4g20lalsnhhp9x",
            phases: [
              {
                coverage: 1,
                dateEnded: "",
                dateStarted: "2023-07-09T15:53:00.000Z",
                name: "Main",
                namespace: undefined,
                prerequisites: [],
                reasonForStopping: "",
                savedGroupTargeting: [],
                seed: "add-cart",
                targetingCondition: "{}",
                trafficSplit: [
                  { variationId: "var_lyel8229", weight: 0.5 },
                  { variationId: "var_lyel822a", weight: 0.5 },
                ],
              },
            ],
            project: "",
            settings: {
              activationMetric: {
                metricId: "met_dd4gxd4lyel6394",
                overrides: {},
              },
              assignmentQueryId: "user_id",
              attributionModel: "firstExposure",
              datasourceId: "ds_dd4gxd4lyel5js1",
              experimentId: "add-cart",
              goals: [{ metricId: "metric-aacc", overrides: {} }],
              guardrails: [{ metricId: "metric-eeff", overrides: {} }],
              inProgressConversions: "include",
              queryFilter: "",
              regressionAdjustmentEnabled: false,
              sequentialTestingEnabled: false,
              sequentialTestingTuningParameter: 5000,
              secondaryMetrics: [{ metricId: "metric-ccdd", overrides: {} }],
              segmentId: "",
              statsEngine: "bayesian",
            },
            status: "running",
            tags: [],
            variations: [
              {
                description: "",
                key: "0",
                name: "Control",
                screenshots: [],
                variationId: "var_lyel8229",
              },
              {
                description: "",
                key: "1",
                name: "Variation 1",
                screenshots: [],
                variationId: "var_lyel822a",
              },
            ],
            shareLevel: "organization",
            trackingKey: "add-cart",
            type: "standard",
          }),
          previous: expect.objectContaining({
            archived: false,
            autoRefresh: true,
            bucketVersion: 1,
            dateCreated: expect.any(String),
            dateUpdated: expect.any(String),
            description: "",
            disableStickyBucketing: false,
            fallbackAttribute: "",
            hashAttribute: "id",
            hashVersion: 2,
            hypothesis: "",
            id: "exp_dd4gxd4lyel8bwi",
            minBucketVersion: 0,
            name: "Add To Cart",
            owner: "u_dd4g20lalsnhhp9x",
            phases: [
              {
                coverage: 1,
                dateEnded: "",
                dateStarted: "2023-07-09T15:53:00.000Z",
                name: "Main",
                namespace: undefined,
                prerequisites: [],
                reasonForStopping: "",
                savedGroupTargeting: [],
                seed: "add-cart",
                targetingCondition: "{}",
                trafficSplit: [
                  { variationId: "var_lyel8229", weight: 0.5 },
                  { variationId: "var_lyel822a", weight: 0.5 },
                ],
              },
            ],
            project: "",
            settings: {
              activationMetric: {
                metricId: "met_dd4gxd4lyel6394",
                overrides: {},
              },
              assignmentQueryId: "user_id",
              attributionModel: "firstExposure",
              datasourceId: "ds_dd4gxd4lyel5js1",
              experimentId: "add-cart",
              goals: [{ metricId: "metric-aacc", overrides: {} }],
              guardrails: [{ metricId: "metric-eeff", overrides: {} }],
              inProgressConversions: "include",
              queryFilter: "",
              regressionAdjustmentEnabled: false,
              sequentialTestingEnabled: false,
              sequentialTestingTuningParameter: 5000,
              secondaryMetrics: [{ metricId: "metric-ccdd", overrides: {} }],
              segmentId: "",
              statsEngine: "bayesian",
            },
            status: "running",
            tags: [],
            variations: [
              {
                description: "",
                key: "0",
                name: "Control",
                screenshots: [],
                variationId: "var_lyel8229",
              },
              {
                description: "",
                key: "1",
                name: "Variation 1",
                screenshots: [],
                variationId: "var_lyel822a",
              },
            ],
            shareLevel: "organization",
            trackingKey: "add-cart",
            type: "standard",
          }),
        }),
        environments: [],
        event: "experiment.updated",
        object: "experiment",
        projects: [""],
        tags: [],
        user: {
          email: "user@mail.com",
          id: "aabb",
          name: "User Name",
          type: "dashboard",
        },
      }),
    );
  });

  it("dispatches experiment.deleted event on experiment delete", async () => {
    let rawPayload;

    jest.spyOn(EventModel, "create").mockImplementation(({ data }) => {
      rawPayload = data;
      return { toJSON: () => "" };
    });

    await logExperimentDeleted(
      {
        org,
        userId: "aabb",
        email: "user@mail.com",
        userName: "User Name",
      },
      experimentSnapshot,
    );

    expect(rawPayload).toEqual(
      expect.objectContaining({
        api_version: expect.any(String),
        created: expect.any(Number),
        containsSecrets: false,
        data: expect.objectContaining({
          object: expect.objectContaining({
            archived: false,
            autoRefresh: true,
            bucketVersion: 1,
            dateCreated: expect.any(String),
            dateUpdated: expect.any(String),
            description: "",
            disableStickyBucketing: false,
            fallbackAttribute: "",
            hashAttribute: "id",
            hashVersion: 2,
            hypothesis: "",
            id: "exp_dd4gxd4lyel8bwi",
            minBucketVersion: 0,
            name: "Add To Cart",
            owner: "u_dd4g20lalsnhhp9x",
            phases: [
              {
                coverage: 1,
                dateEnded: "",
                dateStarted: "2023-07-09T15:53:00.000Z",
                name: "Main",
                namespace: undefined,
                prerequisites: [],
                reasonForStopping: "",
                savedGroupTargeting: [],
                seed: "add-cart",
                targetingCondition: "{}",
                trafficSplit: [
                  { variationId: "var_lyel8229", weight: 0.5 },
                  { variationId: "var_lyel822a", weight: 0.5 },
                ],
              },
            ],
            project: "",
            settings: {
              activationMetric: {
                metricId: "met_dd4gxd4lyel6394",
                overrides: {},
              },
              assignmentQueryId: "user_id",
              attributionModel: "firstExposure",
              datasourceId: "ds_dd4gxd4lyel5js1",
              experimentId: "add-cart",
              goals: [{ metricId: "metric-aacc", overrides: {} }],
              guardrails: [{ metricId: "metric-eeff", overrides: {} }],
              inProgressConversions: "include",
              queryFilter: "",
              regressionAdjustmentEnabled: false,
              sequentialTestingEnabled: false,
              sequentialTestingTuningParameter: 5000,
              secondaryMetrics: [{ metricId: "metric-ccdd", overrides: {} }],
              segmentId: "",
              statsEngine: "bayesian",
            },
            status: "running",
            tags: [],
            variations: [
              {
                description: "",
                key: "0",
                name: "Control",
                screenshots: [],
                variationId: "var_lyel8229",
              },
              {
                description: "",
                key: "1",
                name: "Variation 1",
                screenshots: [],
                variationId: "var_lyel822a",
              },
            ],
            shareLevel: "organization",
            trackingKey: "add-cart",
            type: "standard",
          }),
        }),
        environments: [],
        event: "experiment.deleted",
        object: "experiment",
        projects: [""],
        tags: [],
      }),
    );

    expect(getLegacyMessageForNotificationEvent(rawPayload)).toEqual(
      expect.objectContaining({
        containsSecrets: false,
        data: expect.objectContaining({
          previous: expect.objectContaining({
            archived: false,
            autoRefresh: true,
            bucketVersion: 1,
            dateCreated: expect.any(String),
            dateUpdated: expect.any(String),
            description: "",
            disableStickyBucketing: false,
            fallbackAttribute: "",
            hashAttribute: "id",
            hashVersion: 2,
            hypothesis: "",
            id: "exp_dd4gxd4lyel8bwi",
            minBucketVersion: 0,
            name: "Add To Cart",
            owner: "u_dd4g20lalsnhhp9x",
            phases: [
              {
                coverage: 1,
                dateEnded: "",
                dateStarted: "2023-07-09T15:53:00.000Z",
                name: "Main",
                namespace: undefined,
                prerequisites: [],
                reasonForStopping: "",
                savedGroupTargeting: [],
                seed: "add-cart",
                targetingCondition: "{}",
                trafficSplit: [
                  { variationId: "var_lyel8229", weight: 0.5 },
                  { variationId: "var_lyel822a", weight: 0.5 },
                ],
              },
            ],
            project: "",
            settings: {
              activationMetric: {
                metricId: "met_dd4gxd4lyel6394",
                overrides: {},
              },
              assignmentQueryId: "user_id",
              attributionModel: "firstExposure",
              datasourceId: "ds_dd4gxd4lyel5js1",
              experimentId: "add-cart",
              goals: [{ metricId: "metric-aacc", overrides: {} }],
              guardrails: [{ metricId: "metric-eeff", overrides: {} }],
              inProgressConversions: "include",
              queryFilter: "",
              regressionAdjustmentEnabled: false,
              sequentialTestingEnabled: false,
              sequentialTestingTuningParameter: 5000,
              secondaryMetrics: [{ metricId: "metric-ccdd", overrides: {} }],
              segmentId: "",
              statsEngine: "bayesian",
            },
            status: "running",
            tags: [],
            variations: [
              {
                description: "",
                key: "0",
                name: "Control",
                screenshots: [],
                variationId: "var_lyel8229",
              },
              {
                description: "",
                key: "1",
                name: "Variation 1",
                screenshots: [],
                variationId: "var_lyel822a",
              },
            ],
            shareLevel: "organization",
            trackingKey: "add-cart",
            type: "standard",
          }),
        }),
        environments: [],
        event: "experiment.deleted",
        object: "experiment",
        projects: [""],
        tags: [],
        user: {
          email: "user@mail.com",
          id: "aabb",
          name: "User Name",
          type: "dashboard",
        },
      }),
    );
  });

  it("dispatches experiment.warnings event on multiple exposures", async () => {
    let rawPayload;

    jest.spyOn(EventModel, "create").mockImplementation(({ data }) => {
      if (data.event === "experiment.warning") rawPayload = data;
      return { toJSON: () => "" };
    });

    jest
      .spyOn(ExperimentModel, "updateOne")
      .mockImplementation(() => undefined);

    await notifyMultipleExposures({
      context: {
        org,
        userId: "user-aabb",
        email: "user@email.com",
        userName: "User Name",
        auditUser: {
          type: "api_key",
          apiKey: "aabbcc",
        },
      },
      experiment: experimentSnapshot,
      currentStatus: {
        status: "unhealthy",
        unhealthyData: {
          multipleExposures: {
            rawDecimal: 0.1,
            multipleExposedUsers: 10,
          },
        },
      },
    });

    expect(rawPayload).toEqual(
      expect.objectContaining({
        api_version: expect.any(String),
        containsSecrets: false,
        created: expect.any(Number),
        environments: [],
        event: "experiment.warning",
        object: "experiment",
        projects: [],
        tags: [],
        data: {
          object: {
            experimentId: "exp_dd4gxd4lyel8bwi",
            experimentName: "Add To Cart",
            percent: 0.1,
            type: "multiple-exposures",
            usersCount: 10,
          },
        },
        user: {
          email: "user@email.com",
          id: "user-aabb",
          name: "User Name",
          type: "dashboard",
        },
      }),
    );

    expect(getLegacyMessageForNotificationEvent(rawPayload)).toEqual({
      containsSecrets: false,
      data: {
        experimentId: "exp_dd4gxd4lyel8bwi",
        experimentName: "Add To Cart",
        percent: 0.1,
        type: "multiple-exposures",
        usersCount: 10,
      },
      environments: [],
      event: "experiment.warning",
      object: "experiment",
      projects: [],
      tags: [],
      user: {
        email: "user@email.com",
        id: "user-aabb",
        name: "User Name",
        type: "dashboard",
      },
    });
  });

  it("dispatches experiment.warnings event on srm", async () => {
    let rawPayload;

    jest.spyOn(EventModel, "create").mockImplementation(({ data }) => {
      if (data.event === "experiment.warning") rawPayload = data;
      return { toJSON: () => "" };
    });

    jest
      .spyOn(ExperimentModel, "updateOne")
      .mockImplementation(() => undefined);

    await notifySrm({
      context: {
        org: { ...org, settings: { srmThreshold: 0.5 } },
        userId: "user-aabb",
        email: "user@email.com",
        userName: "User Name",
        auditUser: {
          type: "api_key",
          apiKey: "aabbcc",
        },
      },
      experiment: experimentSnapshot,
      currentStatus: {
        status: "unhealthy",
        unhealthyData: { srm: true },
      },
      healthSettings: { srmThreshold: 0.5 },
    });

    expect(rawPayload).toEqual(
      expect.objectContaining({
        api_version: expect.any(String),
        containsSecrets: false,
        created: expect.any(Number),
        environments: [],
        event: "experiment.warning",
        object: "experiment",
        projects: [],
        tags: [],
        data: {
          object: {
            experimentId: "exp_dd4gxd4lyel8bwi",
            experimentName: "Add To Cart",
            threshold: 0.5,
            type: "srm",
          },
        },
        user: {
          email: "user@email.com",
          id: "user-aabb",
          name: "User Name",
          type: "dashboard",
        },
      }),
    );

    expect(getLegacyMessageForNotificationEvent(rawPayload)).toEqual({
      containsSecrets: false,
      data: {
        experimentId: "exp_dd4gxd4lyel8bwi",
        experimentName: "Add To Cart",
        threshold: 0.5,
        type: "srm",
      },
      environments: [],
      event: "experiment.warning",
      object: "experiment",
      projects: [],
      tags: [],
      user: {
        email: "user@email.com",
        id: "user-aabb",
        name: "User Name",
        type: "dashboard",
      },
    });
  });

  it("dispatches decision update when decision to ship", async () => {
    let rawPayload;

    jest.spyOn(EventModel, "create").mockImplementation(({ data }) => {
      if (data.event === "experiment.decision.ship") rawPayload = data;
      return { toJSON: () => "" };
    });

    jest
      .spyOn(ExperimentModel, "updateOne")
      .mockImplementation(() => undefined);

    const tooltip =
      "All goal metrics are statistically significant in the desired direction for a test variation and experiment has reached the target statistical power.";
    await notifyDecision({
      context: {
        org: org,
        userId: "user-aabb",
        email: "user@email.com",
        userName: "User Name",
        auditUser: {
          type: "api_key",
          apiKey: "aabbcc",
        },
      },
      experiment: experimentSnapshot,
      currentStatus: { status: "ship-now", tooltip: tooltip },
    });

    expect(rawPayload).toEqual(
      expect.objectContaining({
        api_version: expect.any(String),
        containsSecrets: false,
        created: expect.any(Number),
        environments: [],
        event: "experiment.decision.ship",
        object: "experiment",
        projects: [],
        tags: [],
        data: {
          object: {
            experimentId: "exp_dd4gxd4lyel8bwi",
            experimentName: "Add To Cart",
            decisionDescription: tooltip,
          },
        },
        user: {
          email: "user@email.com",
          id: "user-aabb",
          name: "User Name",
          type: "dashboard",
        },
      }),
    );
  });

  it("dispatches decision update when decision to rollback", async () => {
    let rawPayload;

    jest.spyOn(EventModel, "create").mockImplementation(({ data }) => {
      if (data.event === "experiment.decision.rollback") rawPayload = data;
      return { toJSON: () => "" };
    });

    jest
      .spyOn(ExperimentModel, "updateOne")
      .mockImplementation(() => undefined);

    const tooltip =
      "All goal metrics are statistically significant in the undesired direction and experiment has reached the target statistical power.";
    await notifyDecision({
      context: {
        org: org,
        userId: "user-aabb",
        email: "user@email.com",
        userName: "User Name",
        auditUser: {
          type: "api_key",
          apiKey: "aabbcc",
        },
      },
      experiment: experimentSnapshot,
      currentStatus: { status: "rollback-now", tooltip: tooltip },
    });

    expect(rawPayload).toEqual(
      expect.objectContaining({
        api_version: expect.any(String),
        containsSecrets: false,
        created: expect.any(Number),
        environments: [],
        event: "experiment.decision.rollback",
        object: "experiment",
        projects: [],
        tags: [],
        data: {
          object: {
            experimentId: "exp_dd4gxd4lyel8bwi",
            experimentName: "Add To Cart",
            decisionDescription: tooltip,
          },
        },
        user: {
          email: "user@email.com",
          id: "user-aabb",
          name: "User Name",
          type: "dashboard",
        },
      }),
    );
  });

  it("dispatches decision update when decision ready to review", async () => {
    let rawPayload;

    jest.spyOn(EventModel, "create").mockImplementation(({ data }) => {
      if (data.event === "experiment.decision.review") rawPayload = data;
      return { toJSON: () => "" };
    });

    jest
      .spyOn(ExperimentModel, "updateOne")
      .mockImplementation(() => undefined);

    const tooltip =
      "All goal metrics are statistically significant in the desired direction for a test variation and experiment has reached the target statistical power. However, one or more guardrails are failing";
    await notifyDecision({
      context: {
        org: org,
        userId: "user-aabb",
        email: "user@email.com",
        userName: "User Name",
        auditUser: {
          type: "api_key",
          apiKey: "aabbcc",
        },
      },
      experiment: experimentSnapshot,
      currentStatus: { status: "ready-for-review", tooltip: tooltip },
    });

    expect(rawPayload).toEqual(
      expect.objectContaining({
        api_version: expect.any(String),
        containsSecrets: false,
        created: expect.any(Number),
        environments: [],
        event: "experiment.decision.review",
        object: "experiment",
        projects: [],
        tags: [],
        data: {
          object: {
            experimentId: "exp_dd4gxd4lyel8bwi",
            experimentName: "Add To Cart",
            decisionDescription: tooltip,
          },
        },
        user: {
          email: "user@email.com",
          id: "user-aabb",
          name: "User Name",
          type: "dashboard",
        },
      }),
    );
  });

  it("only dispatch decision update when status changes", async () => {
    let rawPayload;

    jest.spyOn(EventModel, "create").mockImplementation(({ data }) => {
      if (data.event === "experiment.decision.review") rawPayload = data;
      return { toJSON: () => "" };
    });

    jest
      .spyOn(ExperimentModel, "updateOne")
      .mockImplementation(() => undefined);

    // no change
    await notifyDecision({
      context: {
        org: org,
        userId: "user-aabb",
        email: "user@email.com",
        userName: "User Name",
        auditUser: {
          type: "api_key",
          apiKey: "aabbcc",
        },
      },
      experiment: experimentSnapshot,
      currentStatus: { status: "ready-for-review" },
      lastStatus: { status: "ready-for-review" },
    });

    expect(rawPayload).toEqual(undefined);

    // changes from rollback to review
    const tooltip =
      "All goal metrics are statistically significant in the desired direction for a test variation and experiment has reached the target statistical power. However, one or more guardrails are failing";
    await notifyDecision({
      context: {
        org: org,
        userId: "user-aabb",
        email: "user@email.com",
        userName: "User Name",
        auditUser: {
          type: "api_key",
          apiKey: "aabbcc",
        },
      },
      experiment: experimentSnapshot,
      currentStatus: { status: "ready-for-review", tooltip: tooltip },
      lastStatus: { status: "rollback-now" },
    });

    expect(rawPayload).toEqual(
      expect.objectContaining({
        api_version: expect.any(String),
        containsSecrets: false,
        created: expect.any(Number),
        environments: [],
        event: "experiment.decision.review",
        object: "experiment",
        projects: [],
        tags: [],
        data: {
          object: {
            experimentId: "exp_dd4gxd4lyel8bwi",
            experimentName: "Add To Cart",
            decisionDescription: tooltip,
          },
        },
        user: {
          email: "user@email.com",
          id: "user-aabb",
          name: "User Name",
          type: "dashboard",
        },
      }),
    );
  });
});
