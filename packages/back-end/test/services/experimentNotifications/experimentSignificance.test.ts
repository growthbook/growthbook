import { Promise as BluebirdPromise } from "bluebird";
import { ensureAndReturn } from "shared/util";
import { Permissions } from "shared/permissions";
import { setupApp } from "back-end/test/api/api.setup";
import { insertMetric } from "back-end/src/models/MetricModel";
import { ExperimentModel } from "back-end/src/models/ExperimentModel";
import {
  getConfidenceLevelsForOrg,
  getMetricDefaultsForOrg,
  getPValueThresholdForOrg,
} from "back-end/src/services/organizations";
import { getLatestSnapshot } from "back-end/src/models/ExperimentSnapshotModel";
import { computeExperimentChanges } from "back-end/src/services/experimentNotifications";
import { ReqContext } from "../../../types/organization";
import { MetricInterface } from "../../../types/metric";
import {
  metrics,
  snapshots,
  experiments,
} from "./experimentSignificance.mocks.json";

jest.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  getLatestSnapshot: jest.fn(),
}));

jest.mock("back-end/src/services/organizations", () => ({
  getConfidenceLevelsForOrg: jest.fn(),
  getEnvironmentIdsFromOrg: jest.fn(),
  getMetricDefaultsForOrg: jest.fn(),
  getPValueThresholdForOrg: jest.fn(),
}));

const testCases = [
  // negative significance for metric 0 in base snapshot
  {
    beforeSnapshot: undefined,
    currentSnapshot: snapshots.base,
    getConfidenceLevelsForOrg: { ciUpper: 0.95, ciLower: 0.05 },
    getMetricDefaultsForOrg: [],
    getPValueThresholdForOrg: 0.4,
    expected: [
      {
        metricId: snapshots.base.settings.goalMetrics[0],
        winning: false,
      },
    ],
  },
  // if snapshot results are identical, no notif
  {
    beforeSnapshot: snapshots.base,
    currentSnapshot: snapshots.base,
    getConfidenceLevelsForOrg: { ciUpper: 0.95, ciLower: 0.05 },
    getMetricDefaultsForOrg: [],
    getPValueThresholdForOrg: 0.4,
    expected: [],
  },
  // if org confidence level is ridiculously strict, no notif
  {
    beforeSnapshot: undefined,
    currentSnapshot: snapshots.base,
    getConfidenceLevelsForOrg: { ciUpper: 0.95, ciLower: 1e-14 },
    getMetricDefaultsForOrg: [],
    getPValueThresholdForOrg: 0.4,
    expected: [],
  },
  // if snapshot before was not significant, fire negative notif
  {
    beforeSnapshot: snapshots.noSignificance,
    currentSnapshot: snapshots.base,
    getConfidenceLevelsForOrg: { ciUpper: 0.95, ciLower: 0.05 },
    getMetricDefaultsForOrg: [],
    getPValueThresholdForOrg: 0.4,
    expected: [
      {
        metricId: snapshots.base.settings.goalMetrics[0],
        winning: false,
      },
    ],
  },
  // if snapshot before was significant, but current is not, no notif
  {
    beforeSnapshot: snapshots.base,
    currentSnapshot: snapshots.noSignificance,
    getConfidenceLevelsForOrg: { ciUpper: 0.95, ciLower: 0.05 },
    getMetricDefaultsForOrg: [],
    getPValueThresholdForOrg: 0.4,
    expected: [],
  },
  // if metric was missing in old snapshot, notify if now significant
  {
    beforeSnapshot: snapshots.missingMetrics,
    currentSnapshot: snapshots.base,
    getConfidenceLevelsForOrg: { ciUpper: 0.95, ciLower: 0.05 },
    getMetricDefaultsForOrg: [],
    getPValueThresholdForOrg: 0.4,
    expected: [
      {
        metricId: snapshots.base.settings.goalMetrics[0],
        winning: false,
      },
    ],
  },
];

describe("Experiment Significance notifications", () => {
  const { isReady, setReqContext } = setupApp();

  beforeAll(async () => {
    await isReady;

    const globalContext = {
      org: { id: "org1" },
      permissions: new Permissions({
        global: {
          permissions: { createMetrics: true },
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      }),
    } as ReqContext;

    setReqContext(globalContext);

    await Promise.all(
      metrics.map(async (metric) => {
        await insertMetric(globalContext, metric as unknown as MetricInterface);
      }),
    );

    await experiments.map(async (exp) => {
      await ExperimentModel.create(exp);
    });
  });

  it("detects significance", async () => {
    await BluebirdPromise.each(
      testCases,
      async ({ beforeSnapshot, currentSnapshot, expected, ...params }) => {
        getLatestSnapshot.mockReturnValue(beforeSnapshot);
        getConfidenceLevelsForOrg.mockReturnValue(
          params.getConfidenceLevelsForOrg,
        );
        getMetricDefaultsForOrg.mockReturnValue(params.getMetricDefaultsForOrg);
        getPValueThresholdForOrg.mockReturnValue(
          params.getPValueThresholdForOrg,
        );

        const experiment = ensureAndReturn(
          await ExperimentModel.findOne({ id: currentSnapshot.experiment }),
        );

        const results = await computeExperimentChanges({
          context: {
            org: { id: experiment.organization },
            permissions: { canReadMultiProjectResource: () => true },
          },
          experiment,
          snapshot: currentSnapshot,
        });

        expect(results).toEqual(
          expected.map((r) => expect.objectContaining(r)),
        );
      },
    );
  });
});
