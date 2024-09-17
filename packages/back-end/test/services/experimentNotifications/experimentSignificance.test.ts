import { Promise as BluebirdPromise } from "bluebird";
import { setupApp } from "../../api/api.setup";
import { insertMetric } from "../../../src/models/MetricModel";
import { ExperimentModel } from "../../../src/models/ExperimentModel";
import {
  getConfidenceLevelsForOrg,
  getMetricDefaultsForOrg,
  getPValueThresholdForOrg,
} from "../../../src/services/organizations";
import { getLatestSnapshot } from "../../../src/models/ExperimentSnapshotModel";
import { computeExperimentChanges } from "../../../src/services/experimentNotifications";
import { ensureAndReturn } from "../../../src/util/types";
import {
  metrics,
  snapshots,
  experiments,
} from "./experimentSignificance.mocks.json";

jest.mock("../../../src/models/ExperimentSnapshotModel", () => ({
  getLatestSnapshot: jest.fn(),
}));

jest.mock("../../../src/services/organizations", () => ({
  getConfidenceLevelsForOrg: jest.fn(),
  getEnvironmentIdsFromOrg: jest.fn(),
  getMetricDefaultsForOrg: jest.fn(),
  getPValueThresholdForOrg: jest.fn(),
}));

const testCases = [
  {
    beforeSnapshot: snapshots.base,
    currentSnapshot: snapshots.base,
    getConfidenceLevelsForOrg: { ciUpper: 0.95, ciLower: 0.05 },
    getMetricDefaultsForOrg: [],
    getPValueThresholdForOrg: 0.4,
    expected: [
      {
        metricId: snapshots.base.settings.goalMetrics[0],
        winning: true,
      },
    ],
  },
];

describe("Experiment Significance notifications", () => {
  setupApp();

  beforeAll(async () => {
    await metrics.map(insertMetric);
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
          params.getConfidenceLevelsForOrg
        );
        getMetricDefaultsForOrg.mockReturnValue(params.getMetricDefaultsForOrg);
        getPValueThresholdForOrg.mockReturnValue(
          params.getPValueThresholdForOrg
        );

        const experiment = ensureAndReturn(
          await ExperimentModel.findOne({ id: currentSnapshot.experiment })
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
          expected.map((r) => expect.objectContaining(r))
        );
      }
    );
  });
});
