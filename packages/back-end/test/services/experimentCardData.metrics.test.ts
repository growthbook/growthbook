import type { ExperimentInterface } from "shared/types/experiment";
import type { ExperimentMetricInterface } from "shared/experiments";
import type { OrganizationSettings } from "shared/types/organization";
import type { ProjectInterface } from "shared/types/project";
import type { SnapshotMetric } from "shared/types/experiment-snapshot";
import type { Context } from "back-end/src/models/BaseModel";
import { buildExperimentCardData } from "back-end/src/services/notificationCards/experimentCardData";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getLatestSuccessfulSnapshot } from "back-end/src/models/ExperimentSnapshotModel";
import { getExperimentMetricsByIds } from "back-end/src/services/experiments";
import { snapshotFactory } from "../factories/Snapshot.factory";

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

describe("card analysis settings", () => {
  const contextWithSettings = (
    settings: OrganizationSettings = {},
    projects: ProjectInterface[] = [],
  ): Context => ({
    ...context,
    org: { ...context.org, settings },
    getProjects: async () => projects,
  });

  const baseline: SnapshotMetric = { value: 100, cr: 0.1, users: 1000 };
  const treatment: SnapshotMetric = {
    value: 110,
    cr: 0.11,
    users: 1000,
    expected: 0.1,
    pValue: 0.02,
    chanceToWin: 0.97,
    ci: [0.01, 0.19],
    uplift: { dist: "normal", mean: 0.1, stddev: 0.04 },
  };

  const resultsSnapshot = () =>
    snapshotFactory.build({
      type: "standard",
      analyses: [
        {
          analysisKey: "default",
          dateCreated: new Date(),
          status: "success",
          settings: {
            statsEngine: "frequentist",
            differenceType: "relative",
            dimensions: [],
            numGoalMetrics: 2,
            numGuardrailMetrics: 1,
          },
          results: [
            {
              name: "",
              srm: 0.005,
              variations: [
                {
                  users: 1000,
                  metrics: {
                    goal: { ...baseline },
                    secondary: { ...baseline },
                    guardrail: { ...baseline },
                  },
                },
                {
                  users: 1000,
                  metrics: {
                    goal: { ...treatment },
                    secondary: { ...treatment },
                    guardrail: { ...treatment },
                  },
                },
              ],
            },
          ],
        },
      ],
    });

  beforeEach(() => {
    jest.mocked(getExperimentById).mockResolvedValue(
      experiment({
        status: "running",
        goalMetrics: ["goal", "secondary"],
        secondaryMetrics: ["secondary"],
        guardrailMetrics: ["guardrail"],
        variations: [
          { id: "control", name: "Control", key: "0", screenshots: [] },
          { id: "treatment", name: "Treatment", key: "1", screenshots: [] },
        ],
      }),
    );
    jest
      .mocked(getLatestSuccessfulSnapshot)
      .mockResolvedValue(resultsSnapshot());
  });

  it("uses the organization SRM threshold for both state and displayed threshold", async () => {
    const defaults = await buildExperimentCardData(
      contextWithSettings(),
      "exp",
    );
    expect(defaults?.state).toBe("running");
    const configured = await buildExperimentCardData(
      contextWithSettings({ srmThreshold: 0.01 }),
      "exp",
    );
    expect(configured?.state).toBe("warning");
    expect(configured?.p).toBe("p < 0.01");
  });

  it("uses dedicated health traffic and SRM before results-analysis values", async () => {
    const snapshot = resultsSnapshot();
    snapshot.health = {
      traffic: {
        overall: { name: "", srm: 0.00001, variationUnits: [1000, 1000] },
        dimension: {},
      },
    };
    snapshot.analyses[0].results[0].srm = 1;
    snapshot.analyses[0].results[0].variations.forEach((variation) => {
      variation.users = 1;
    });
    jest.mocked(getLatestSuccessfulSnapshot).mockResolvedValue(snapshot);
    const card = await buildExperimentCardData(contextWithSettings(), "exp");
    expect(card?.state).toBe("warning");
    expect(card?.users).toBe("2K");
  });

  it("does not flag SRM before the shared minimum traffic requirement", async () => {
    const snapshot = resultsSnapshot();
    snapshot.analyses[0].results[0].srm = 0.00001;
    snapshot.analyses[0].results[0].variations.forEach((variation) => {
      variation.users = 1;
    });
    jest.mocked(getLatestSuccessfulSnapshot).mockResolvedValue(snapshot);
    expect(
      (await buildExperimentCardData(contextWithSettings(), "exp"))?.state,
    ).toBe("running");
  });

  it("uses the configured multiple-exposure percentage", async () => {
    const snapshot = resultsSnapshot();
    snapshot.multipleExposures = 40;
    jest.mocked(getLatestSuccessfulSnapshot).mockResolvedValue(snapshot);
    const defaults = await buildExperimentCardData(
      contextWithSettings(),
      "exp",
    );
    expect(defaults?.health?.issues[0][0]).toBe("Multiple exposures");
    const configured = await buildExperimentCardData(
      contextWithSettings({ multipleExposureMinPercent: 0.05 }),
      "exp",
    );
    expect(configured?.health).toBeUndefined();
  });

  it("uses the org p-value threshold and project override", async () => {
    const strict = await buildExperimentCardData(
      contextWithSettings({ pValueThreshold: 0.01 }),
      "exp",
    );
    expect(strict?.secondary?.[0].sig).toBe(false);
    const currentExperiment = await getExperimentById(context, "exp");
    jest
      .mocked(getExperimentById)
      .mockResolvedValue({ ...currentExperiment!, project: "prj" });
    const project = {
      id: "prj",
      organization: "org",
      name: "Project",
      description: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      settings: { pValueThreshold: 0.05 },
    };
    const overridden = await buildExperimentCardData(
      contextWithSettings({ pValueThreshold: 0.01 }, [project]),
      "exp",
    );
    expect(overridden?.secondary?.[0].sig).toBe(true);
  });

  it("uses the Bayesian confidence setting instead of p-values", async () => {
    const snapshot = resultsSnapshot();
    snapshot.analyses[0].settings.statsEngine = "bayesian";
    jest.mocked(getLatestSuccessfulSnapshot).mockResolvedValue(snapshot);
    const card = await buildExperimentCardData(
      contextWithSettings({ confidenceLevel: 0.99 }),
      "exp",
    );
    expect(card?.secondary?.[0].sig).toBe(false);
  });

  it("does not label missing Bayesian statistics significant", async () => {
    const snapshot = resultsSnapshot();
    snapshot.analyses[0].settings.statsEngine = "bayesian";
    delete snapshot.analyses[0].results[0].variations[1].metrics.secondary
      .chanceToWin;
    jest.mocked(getLatestSuccessfulSnapshot).mockResolvedValue(snapshot);
    const card = await buildExperimentCardData(contextWithSettings(), "exp");
    expect(card?.secondary?.[0].sig).toBe(false);
  });

  it("corrects all goal metrics without mutating the stored snapshot or correcting guardrails", async () => {
    const snapshot = resultsSnapshot();
    jest.mocked(getLatestSuccessfulSnapshot).mockResolvedValue(snapshot);
    const card = await buildExperimentCardData(
      contextWithSettings({
        pValueThreshold: 0.03,
        pValueCorrection: "holm-bonferroni",
      }),
      "exp",
    );
    expect(card?.secondary?.[0].sig).toBe(false);
    expect(card?.guardrail?.[0].sig).toBe(true);
    expect(card?.rows[0].ci?.lo).toBeLessThan(0);
    expect(
      snapshot.analyses[0].results[0].variations[1].metrics.goal.pValueAdjusted,
    ).toBeUndefined();
    expect(
      snapshot.analyses[0].results[0].variations[1].metrics.goal.ciAdjusted,
    ).toBeUndefined();
  });

  it("keeps snapshot confidence intervals without inventing a 95% distribution", async () => {
    const snapshot = resultsSnapshot();
    delete snapshot.analyses[0].results[0].variations[1].metrics.goal.uplift;
    jest.mocked(getLatestSuccessfulSnapshot).mockResolvedValue(snapshot);
    const card = await buildExperimentCardData(contextWithSettings(), "exp");
    expect(card?.rows[0].vio).toBeUndefined();
    expect(card?.rows[0].ci).toEqual({ lo: 1, hi: 19, pt: 10 });
  });
});
