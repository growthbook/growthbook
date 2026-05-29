import { ExperimentInterface } from "shared/types/experiment";
import {
  ContextualBanditInterface,
  ContextualBanditEventInterface,
  ContextualBanditResponseInterface,
} from "shared/validators";
import {
  buildContextualBanditHistoricalWeights,
  totalUsersFromContextualBanditEvent,
  weightsFromContextualBanditEvent,
} from "back-end/src/services/contextualBanditQueries";

// The module pulls in several DB-backed services/models at import time. None
// of the helpers under test use them, so stub them out to keep this a unit
// test (no Mongo, no integrations, no real stats engine).
jest.mock("back-end/src/services/datasource", () => ({
  getIntegrationFromDatasourceId: jest.fn(),
}));
jest.mock("back-end/src/services/experiments", () => ({
  getDefaultExperimentAnalysisSettings: jest.fn(),
  getSnapshotSettings: jest.fn(),
}));
jest.mock("back-end/src/services/experimentQueries/experimentQueries", () => ({
  getFactMetricGroups: jest.fn(),
}));
jest.mock("back-end/src/models/FactTableModel", () => ({
  getFactTableMap: jest.fn(),
}));
jest.mock("back-end/src/models/MetricModel", () => ({
  getMetricMap: jest.fn(),
}));
jest.mock("back-end/src/util/sql", () => ({
  expandDenominatorMetrics: jest.fn(),
}));

function makeResponse(
  overrides: Partial<ContextualBanditResponseInterface> = {},
): ContextualBanditResponseInterface {
  return {
    context: {},
    sampleSizePerVariation: [10, 20],
    variationMeans: [0.1, 0.2],
    updatedWeights: [0.4, 0.6],
    bestArmProbabilities: [0.4, 0.6],
    updateMessage: "ok",
    ...overrides,
  };
}

function makeEvent(
  overrides: Partial<ContextualBanditEventInterface> = {},
): ContextualBanditEventInterface {
  return {
    id: "cbe_1",
    organization: "org_1",
    dateCreated: new Date("2025-01-03T00:00:00Z"),
    dateUpdated: new Date("2025-01-03T00:00:00Z"),
    experiment: "exp_1",
    phase: 0,
    snapshotId: "cbs_1",
    attributes: ["country"],
    responses: [makeResponse()],
    weightsWereUpdated: true,
    ...overrides,
  } as ContextualBanditEventInterface;
}

function makeExperiment(
  overrides: Partial<ExperimentInterface> = {},
): ExperimentInterface {
  return {
    id: "exp_1",
    organization: "org_1",
    variations: [
      { id: "v0", name: "Control", key: "0", screenshots: [] },
      { id: "v1", name: "Treatment", key: "1", screenshots: [] },
    ],
    phases: [
      {
        dateStarted: new Date("2025-01-02T00:00:00Z"),
        variationWeights: [0.4, 0.6],
      },
    ],
    ...overrides,
  } as unknown as ExperimentInterface;
}

function makeCb(
  overrides: Partial<ContextualBanditInterface> = {},
): ContextualBanditInterface {
  return {
    id: "cb_1",
    organization: "org_1",
    experiment: "exp_1",
    phases: [{ dateStarted: new Date("2025-01-02T00:00:00Z") }],
    ...overrides,
  } as unknown as ContextualBanditInterface;
}

describe("weightsFromContextualBanditEvent", () => {
  it("returns the first response with non-empty updatedWeights", () => {
    const cbe = makeEvent({
      responses: [
        makeResponse({ updatedWeights: [0.2, 0.8] }),
        makeResponse({ updatedWeights: [0.1, 0.9] }),
      ],
    });
    expect(weightsFromContextualBanditEvent(cbe)).toEqual([0.2, 0.8]);
  });

  it("skips responses with missing or empty updatedWeights", () => {
    const cbe = makeEvent({
      responses: [
        makeResponse({ updatedWeights: [] }),
        makeResponse({ updatedWeights: undefined }),
        makeResponse({ updatedWeights: [0.3, 0.7] }),
      ],
    });
    expect(weightsFromContextualBanditEvent(cbe)).toEqual([0.3, 0.7]);
  });

  it("returns an empty array when no response has weights", () => {
    const cbe = makeEvent({
      responses: [makeResponse({ updatedWeights: undefined })],
    });
    expect(weightsFromContextualBanditEvent(cbe)).toEqual([]);
  });
});

describe("totalUsersFromContextualBanditEvent", () => {
  it("sums sampleSizePerVariation across all responses and variations", () => {
    const cbe = makeEvent({
      responses: [
        makeResponse({ sampleSizePerVariation: [10, 20] }),
        makeResponse({ sampleSizePerVariation: [5, 7] }),
      ],
    });
    expect(totalUsersFromContextualBanditEvent(cbe)).toBe(42);
  });

  it("treats missing sampleSizePerVariation as zero", () => {
    const cbe = makeEvent({
      responses: [
        makeResponse({ sampleSizePerVariation: undefined }),
        makeResponse({ sampleSizePerVariation: [3, 4] }),
      ],
    });
    expect(totalUsersFromContextualBanditEvent(cbe)).toBe(7);
  });
});

describe("buildContextualBanditHistoricalWeights", () => {
  it("returns a single initial entry when there are no reweight events", () => {
    const result = buildContextualBanditHistoricalWeights(
      makeExperiment(),
      0,
      makeCb(),
      [],
    );
    expect(result).toEqual([
      {
        date: new Date("2025-01-02T00:00:00Z"),
        weights: [0.4, 0.6],
        totalUsers: 0,
      },
    ]);
  });

  it("appends reweight events sorted by dateCreated", () => {
    const later = makeEvent({
      id: "cbe_later",
      dateCreated: new Date("2025-01-05T00:00:00Z"),
      responses: [
        makeResponse({
          updatedWeights: [0.1, 0.9],
          sampleSizePerVariation: [100, 100],
        }),
      ],
    });
    const earlier = makeEvent({
      id: "cbe_earlier",
      dateCreated: new Date("2025-01-04T00:00:00Z"),
      responses: [
        makeResponse({
          updatedWeights: [0.3, 0.7],
          sampleSizePerVariation: [10, 10],
        }),
      ],
    });

    const result = buildContextualBanditHistoricalWeights(
      makeExperiment(),
      0,
      makeCb(),
      [later, earlier],
    );

    expect(result).toEqual([
      {
        date: new Date("2025-01-02T00:00:00Z"),
        weights: [0.4, 0.6],
        totalUsers: 0,
      },
      {
        date: new Date("2025-01-04T00:00:00Z"),
        weights: [0.3, 0.7],
        totalUsers: 20,
      },
      {
        date: new Date("2025-01-05T00:00:00Z"),
        weights: [0.1, 0.9],
        totalUsers: 200,
      },
    ]);
  });

  it("ignores events that did not update weights or have mismatched weight length", () => {
    const notUpdated = makeEvent({
      id: "cbe_noupdate",
      dateCreated: new Date("2025-01-04T00:00:00Z"),
      weightsWereUpdated: false,
    });
    const wrongLength = makeEvent({
      id: "cbe_wrong",
      dateCreated: new Date("2025-01-05T00:00:00Z"),
      responses: [makeResponse({ updatedWeights: [1] })],
    });

    const result = buildContextualBanditHistoricalWeights(
      makeExperiment(),
      0,
      makeCb(),
      [notUpdated, wrongLength],
    );

    expect(result).toHaveLength(1);
    expect(result[0].weights).toEqual([0.4, 0.6]);
  });

  it("falls back to equal weights and the cb phase start when the experiment phase is missing those", () => {
    const experiment = makeExperiment({ phases: [{}] as never });
    const result = buildContextualBanditHistoricalWeights(
      experiment,
      0,
      makeCb(),
      [],
    );
    expect(result).toEqual([
      {
        date: new Date("2025-01-02T00:00:00Z"),
        weights: [0.5, 0.5],
        totalUsers: 0,
      },
    ]);
  });
});
