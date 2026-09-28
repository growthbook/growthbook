import type { ExperimentInterface } from "shared/types/experiment";
import type { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import type { Context } from "back-end/src/models/BaseModel";
import { getLatestSuccessfulSnapshot } from "back-end/src/models/ExperimentSnapshotModel";
import { getStoppedGoalMetricResults } from "back-end/src/services/experimentChanges/experimentStoppedResults";

jest.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  getLatestSuccessfulSnapshot: jest.fn(),
}));
jest.mock("back-end/src/services/experiments", () => ({
  getExperimentMetricsByIds: jest.fn().mockResolvedValue([]),
}));
jest.mock("back-end/src/services/organizations", () => ({
  getSignificanceSettingsForProject: jest.fn().mockResolvedValue({
    ciUpper: 0.95,
    ciLower: 0.05,
    pValueThreshold: 0.05,
    pValueCorrection: null,
  }),
  getMetricDefaultsForOrg: jest.fn(),
}));

const context = { org: { id: "org" } } as Context;
const experiment = {
  id: "exp",
  goalMetrics: ["met"],
  phases: [{ dateStarted: new Date("2026-08-01") }],
  variations: [
    { id: "v0", key: "0", name: "Control" },
    { id: "v1", key: "a", name: "A" },
    { id: "v2", key: "b", name: "B" },
  ],
} as unknown as ExperimentInterface;

const metric = (expected: number, ci: [number, number]) => ({
  met: { cr: 0.1, value: 10, users: 100, expected, ci, pValue: 0.5 },
});

beforeEach(() => {
  jest.mocked(getLatestSuccessfulSnapshot).mockResolvedValue({
    id: "snp",
    settings: { variations: [{ id: "0" }, { id: "b" }, { id: "a" }] },
    analyses: [
      {
        settings: { statsEngine: "frequentist", differenceType: "relative" },
        results: [
          {
            variations: [
              { users: 100, metrics: metric(0, [0, 0]) },
              { users: 100, metrics: metric(0.2, [-Infinity, Infinity]) },
              { users: 100, metrics: metric(-0.1, [-0.2, 0]) },
            ],
          },
        ],
      },
    ],
  } as unknown as ExperimentSnapshotInterface);
});

it("attributes result columns by the snapshot's variation keys", async () => {
  const captured = await getStoppedGoalMetricResults(context, experiment);
  expect(
    captured?.goalMetric.variations.map((v) => [
      v.variationName,
      v.variationIndex,
      v.uplift,
    ]),
  ).toEqual([
    ["B", 2, 0.2],
    ["A", 1, -0.1],
  ]);
});

it("leaves out bounds the payload schema cannot carry", async () => {
  const captured = await getStoppedGoalMetricResults(context, experiment);
  const [b, a] = captured?.goalMetric.variations ?? [];
  expect(b.ci).toBeUndefined();
  expect(a.ci).toEqual([-0.2, 0]);
});
