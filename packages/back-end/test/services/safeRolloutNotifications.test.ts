import { notifySafeRolloutChange } from "back-end/src/services/safeRolloutSnapshots";
import { createEvent } from "back-end/src/models/EventModel";
import { ReqContextClass } from "back-end/src/services/context";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeature: jest.fn(),
}));

jest.mock("back-end/src/models/EventModel", () => ({
  createEvent: jest.fn(),
}));

jest.mock("shared/enterprise", () => ({
  getSafeRolloutResultStatus: jest.fn(),
}));

describe("notifySafeRolloutChange", () => {
  const mockContext: Partial<ReqContextClass> = {
    org: {
      settings: {
        updateSchedule: null,
      },
    },
    models: {
      safeRollout: {
        update: jest.fn(),
      },
    },
    userId: "user-1",
    email: "test@example.com",
    userName: "Test User",
    initModels: jest.fn(),
  };

  const mockFeature = {
    id: "feature-1",
    project: "project-1",
    tags: ["tag1"],
  };

  const mockSafeRollout = {
    id: "safe-rollout-1",
    featureId: "feature-1",
    environment: "production",
    pastNotifications: [],
    organization: "org-1",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    status: "running" as const,
    datasourceId: "ds-1",
    exposureQueryId: "query-1",
    startedAt: new Date(),
    nextSnapshotAttempt: new Date(),
    guardrailMetricIds: [],
    maxDuration: {
      amount: 30,
      unit: "days" as const,
    },
    autoSnapshots: true,
  };

  const mockSafeRolloutSnapshot = {
    id: "snapshot-1",
    organization: "org-1",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    status: "success" as const,
    multipleExposures: 0,
    settings: {
      datasourceId: "ds-1",
      startDate: new Date(),
      endDate: new Date(),
      experimentId: "exp-1",
      exposureQueryId: "query-1",
      variations: [
        { id: "0", weight: 0.5 },
        { id: "1", weight: 0.5 },
      ],
      coverage: 1,
      guardrailMetrics: [],
      dimensions: [],
      metricSettings: [],
      regressionAdjustmentEnabled: false,
      defaultMetricPriorSettings: {
        override: false,
        proper: false,
        mean: 0,
        stddev: 0.1,
      },
      queryFilter: "",
    },
    health: {
      traffic: {
        dimension: {},
        overall: {
          srm: 0.5,
          name: "test",
          variationUnits: [100, 100],
        },
      },
    },
    analyses: [
      {
        dateCreated: new Date(),
        status: "success" as const,
        settings: {
          statsEngine: "frequentist" as const,
          regressionAdjusted: false,
          sequentialTesting: false,
          sequentialTestingTuningParameter: 0.5,
          pValueCorrection: "holm-bonferroni" as const,
        },
        results: [
          {
            srm: 0.5,
            name: "test",
            variations: [
              { users: 100, metrics: {} },
              { users: 100, metrics: {} },
            ],
          },
        ],
      },
    ],
    safeRolloutId: "safe-rollout-1",
    runStarted: new Date(),
    triggeredBy: "manual" as const,
    queries: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("dispatches unhealthy event when safe rollout is unhealthy", async () => {
    const unhealthySafeRollout = {
      ...mockSafeRollout,
      healthSettings: {
        srm: 0.01,
        multipleExposures: 0.1,
      },
    };

    await notifySafeRolloutChange({
      context: mockContext as ReqContextClass,
      updatedSafeRollout: unhealthySafeRollout,
      safeRolloutSnapshot: mockSafeRolloutSnapshot,
    });

    expect(createEvent).toHaveBeenCalledWith({
      context: mockContext,
      object: "feature",
      objectId: mockFeature.id,
      event: "saferollout.unhealthy",
      data: {
        object: {
          featureId: mockFeature.id,
          safeRolloutId: unhealthySafeRollout.id,
          environment: unhealthySafeRollout.environment,
          unhealthyReason: ["srm", "multipleExposures"],
        },
      },
      projects: [mockFeature.project],
      tags: mockFeature.tags,
      environments: [unhealthySafeRollout.environment],
      containsSecrets: false,
    });
  });

  it("dispatches rollback event when safe rollout needs rollback", async () => {
    const rollbackSafeRollout = {
      ...mockSafeRollout,
      healthSettings: {
        status: "rollback-now",
      },
    };

    await notifySafeRolloutChange({
      context: mockContext as ReqContextClass,
      updatedSafeRollout: rollbackSafeRollout,
      safeRolloutSnapshot: mockSafeRolloutSnapshot,
    });

    expect(createEvent).toHaveBeenCalledWith({
      context: mockContext,
      object: "feature",
      objectId: mockFeature.id,
      event: "saferollout.rollback",
      data: {
        object: {
          featureId: mockFeature.id,
          safeRolloutId: rollbackSafeRollout.id,
          environment: rollbackSafeRollout.environment,
        },
      },
      projects: [mockFeature.project],
      tags: mockFeature.tags,
      environments: [rollbackSafeRollout.environment],
      containsSecrets: false,
    });
  });

  it("dispatches ship event when safe rollout is ready to ship", async () => {
    const shipSafeRollout = {
      ...mockSafeRollout,
    };

    await notifySafeRolloutChange({
      context: mockContext as ReqContextClass,
      updatedSafeRollout: shipSafeRollout,
      safeRolloutSnapshot: mockSafeRolloutSnapshot,
    });

    expect(createEvent).toHaveBeenCalledWith({
      context: mockContext,
      object: "feature",
      objectId: mockFeature.id,
      event: "saferollout.ship",
      data: {
        object: {
          featureId: mockFeature.id,
          safeRolloutId: shipSafeRollout.id,
          environment: shipSafeRollout.environment,
        },
      },
      projects: [mockFeature.project],
      tags: mockFeature.tags,
      environments: [shipSafeRollout.environment],
      containsSecrets: false,
    });
  });

  it("memoizes notifications to prevent duplicate events", async () => {
    const safeRolloutWithPastNotifications = {
      ...mockSafeRollout,
      pastNotifications: ["srm" as const],
    };

    await notifySafeRolloutChange({
      context: mockContext,
      updatedSafeRollout: safeRolloutWithPastNotifications,
      safeRolloutSnapshot: mockSafeRolloutSnapshot,
    });

    expect(createEvent).not.toHaveBeenCalled();
  });
});
