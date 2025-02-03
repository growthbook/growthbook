import {
  logExperimentCreated,
  logExperimentUpdated,
  logExperimentDeleted,
  ExperimentModel,
} from "back-end/src/models/ExperimentModel";
import { getLegacyMessageForNotificationEvent } from "back-end/src/events/handlers/legacy";
import { experimentSnapshot } from "back-end/test/snapshots/experiment.snapshot";
import {
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
      experimentSnapshot
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
          }),
        }),
        environments: [],
        event: "experiment.created",
        object: "experiment",
        projects: [""],
        tags: [],
      })
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
      })
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
      })
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
      })
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
      experimentSnapshot
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
          }),
        }),
        environments: [],
        event: "experiment.deleted",
        object: "experiment",
        projects: [""],
        tags: [],
      })
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
      })
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
      experiment: { id: "experiment-aabb", ...experimentSnapshot },
      results: { variations: [{ users: 100 }] },
      snapshot: { multipleExposures: 10, totalUsers: 100 },
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
      })
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
      experiment: { id: "experiment-aabb", ...experimentSnapshot },
      results: { srm: 0.1, variations: [{ users: 50 }, { users: 50 }] },
      snapshot: { multipleExposures: 10, totalUsers: 100 },
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
      })
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
});
