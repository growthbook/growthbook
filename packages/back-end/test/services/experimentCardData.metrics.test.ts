import type { ExperimentInterface } from "shared/types/experiment";
import type { ExperimentMetricInterface } from "shared/experiments";
import type { Context } from "back-end/src/models/BaseModel";
import { buildExperimentCardData } from "back-end/src/services/notificationCards/experimentCardData";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getLatestSuccessfulSnapshot } from "back-end/src/models/ExperimentSnapshotModel";
import { getExperimentMetricsByIds } from "back-end/src/services/experiments";

jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentById: jest.fn(),
}));
jest.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  getLatestSuccessfulSnapshot: jest.fn(),
}));
jest.mock("back-end/src/services/experiments", () => ({
  getExperimentMetricsByIds: jest.fn(),
}));
jest.mock("back-end/src/models/DataSourceModel", () => ({
  getDataSourceById: jest.fn(),
}));
const context = { org: { id: "org" } } as Context;
const experiment = (overrides: Partial<ExperimentInterface> = {}) =>
  ({
    id: "exp",
    name: "Checkout",
    status: "draft",
    phases: [],
    variations: [],
    goalMetrics: [],
    secondaryMetrics: [],
    guardrailMetrics: [],
    ...overrides,
  }) as ExperimentInterface;
const metric = (id: string) =>
  ({ id, name: `Metric ${id}`, type: "binomial" }) as ExperimentMetricInterface;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getLatestSuccessfulSnapshot).mockResolvedValue(null);
  jest
    .mocked(getExperimentMetricsByIds)
    .mockImplementation(async (ctx, ids) => ids.map(metric));
});
it("deduplicates a large draft metric set into one bulk lookup without truncating its lists", async () => {
  const secondary = Array.from(
    { length: 100 },
    (value, index) => `met_${index % 20}`,
  );
  jest.mocked(getExperimentById).mockResolvedValue(
    experiment({
      goalMetrics: ["met_0", "unused_goal"],
      secondaryMetrics: secondary,
      guardrailMetrics: secondary.slice().reverse(),
    }),
  );
  const card = await buildExperimentCardData(context, "exp");
  expect(getExperimentMetricsByIds).toHaveBeenCalledTimes(1);
  expect(getExperimentMetricsByIds).toHaveBeenCalledWith(
    context,
    Array.from({ length: 20 }, (value, index) => `met_${index}`),
  );
  expect(card?.metrics?.secondary).toHaveLength(100);
  expect(card?.metrics?.guardrail).toHaveLength(100);
  expect(getLatestSuccessfulSnapshot).not.toHaveBeenCalled();
});
it.each(["running", "stopped"] as const)(
  "loads only the displayed three secondary and guardrail metrics for %s",
  async (status) => {
    jest.mocked(getExperimentById).mockResolvedValue(
      experiment({
        status,
        goalMetrics: ["goal"],
        secondaryMetrics: ["s1", "s2", "s3", "s4"],
        guardrailMetrics: ["g1", "g2", "g3", "g4"],
      }),
    );
    await buildExperimentCardData(context, "exp");
    expect(getExperimentMetricsByIds).toHaveBeenCalledTimes(1);
    expect(getExperimentMetricsByIds).toHaveBeenCalledWith(context, [
      "goal",
      "s1",
      "s2",
      "s3",
      "g1",
      "g2",
      "g3",
    ]);
  },
);
it("omits missing draft metrics and retains a safe fallback for a missing goal", async () => {
  jest.mocked(getExperimentById).mockResolvedValue(
    experiment({
      goalMetrics: ["missing"],
      secondaryMetrics: ["missing", "found"],
    }),
  );
  jest.mocked(getExperimentMetricsByIds).mockResolvedValue([metric("found")]);
  const card = await buildExperimentCardData(context, "exp");
  expect(card?.goal).toBe("Goal metric");
  expect(card?.metrics?.secondary).toEqual(["Metric found"]);
});
it("resolves slices and funnel steps from deduplicated parent definitions", async () => {
  jest.mocked(getExperimentById).mockResolvedValue(
    experiment({
      goalMetrics: ["fact__funnel?step=1"],
      secondaryMetrics: [
        "met_slice?country=US",
        "met_slice?country=GB",
        "fact__funnel?step=0",
        "fact__funnel?step=99",
      ],
    }),
  );
  jest.mocked(getExperimentMetricsByIds).mockResolvedValue([
    metric("met_slice"),
    {
      id: "fact__funnel",
      name: "Checkout funnel",
      metricType: "funnel",
      funnelSettings: {
        steps: [
          { name: "Cart", factTableId: "table", rowFilters: [] },
          { name: "Purchase", factTableId: "table", rowFilters: [] },
        ],
      },
    } as unknown as ExperimentMetricInterface,
  ]);
  const card = await buildExperimentCardData(context, "exp");
  expect(getExperimentMetricsByIds).toHaveBeenCalledWith(context, [
    "fact__funnel",
    "met_slice",
  ]);
  expect(card?.goal).toBe("Checkout funnel: Purchase");
  expect(card?.metrics?.secondary).toEqual([
    "Metric met_slice",
    "Metric met_slice",
    "Checkout funnel: Cart",
  ]);
});
it("skips bulk lookup when the experiment has no metrics", async () => {
  jest.mocked(getExperimentById).mockResolvedValue(experiment());
  await buildExperimentCardData(context, "exp");
  expect(getExperimentMetricsByIds).not.toHaveBeenCalled();
});
