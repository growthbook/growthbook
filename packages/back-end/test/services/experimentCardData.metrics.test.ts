import type { ExperimentInterface } from "shared/types/experiment";
import type { ExperimentMetricInterface } from "shared/experiments";
import type {
  ExperimentSnapshotAnalysisSettings,
  SnapshotMetric,
} from "shared/types/experiment-snapshot";
import type { MetricGroupInterface } from "shared/types/metric-groups";
import type { ProjectInterface } from "shared/types/project";
import type {
  StandardFactMetricInterface,
  FunnelFactMetricInterface,
} from "shared/types/fact-table";
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
const getMetricGroups = jest.fn<Promise<MetricGroupInterface[]>, []>();
const getProjects = jest.fn<Promise<ProjectInterface[]>, []>();
const context = {
  org: { id: "org" },
  models: { metricGroups: { getAll: getMetricGroups } },
  getProjects,
} as unknown as Context;
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

function metricGroup(id: string, metrics: string[]): MetricGroupInterface {
  return {
    id,
    metrics,
    name: id,
    organization: "org",
    datasource: "ds",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    owner: "",
    description: "",
    tags: [],
    projects: [],
    archived: false,
  };
}

const proportion: StandardFactMetricInterface = {
  id: "fact__proportion",
  name: "Conversion",
  metricType: "proportion",
  organization: "org",
  datasource: "ds",
  dateCreated: new Date(),
  dateUpdated: new Date(),
  owner: "",
  description: "",
  tags: [],
  projects: [],
  inverse: false,
  numerator: { factTableId: "table", column: "value" },
  denominator: null,
  funnelSettings: null,
  quantileSettings: null,
  cappingSettings: { type: "", value: 0 },
  windowSettings: {
    type: "",
    delayValue: 0,
    delayUnit: "days",
    windowValue: 1,
    windowUnit: "days",
  },
  priorSettings: { override: false, proper: false, mean: 0, stddev: 1 },
  maxPercentChange: 100,
  minPercentChange: 0,
  minSampleSize: 100,
  winRisk: 0.1,
  loseRisk: 0.05,
  regressionAdjustmentOverride: false,
  regressionAdjustmentEnabled: false,
  regressionAdjustmentDays: 0,
};

function setResults({
  ids = ["goal", "secondary", "guardrail"],
  settings = {},
  stats = {},
  srm = 0.5,
}: {
  ids?: string[];
  settings?: Partial<ExperimentSnapshotAnalysisSettings>;
  stats?: Partial<SnapshotMetric>;
  srm?: number;
} = {}) {
  const metrics = Object.fromEntries(
    ids.map((id) => [
      id,
      {
        value: 100,
        cr: 0.1,
        users: 1000,
        expected: 0.1,
        ci: [-0.02, 0.22],
        ...stats,
      } satisfies SnapshotMetric,
    ]),
  );
  jest.mocked(getLatestSuccessfulSnapshot).mockResolvedValue(
    snapshotFactory.build({
      analyses: [
        {
          analysisKey: "default",
          dateCreated: new Date(),
          status: "success",
          settings: {
            statsEngine: "frequentist",
            differenceType: "relative",
            dimensions: [],
            numGoalMetrics: 1,
            numGuardrailMetrics: 1,
            ...settings,
          },
          results: [
            {
              name: "",
              srm,
              variations: [
                { users: 1000, metrics },
                { users: 1000, metrics },
              ],
            },
          ],
        },
      ],
    }),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  context.org.settings = {};
  getMetricGroups.mockResolvedValue([]);
  getProjects.mockResolvedValue([]);
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

describe("result thresholds", () => {
  beforeEach(() => {
    jest.mocked(getExperimentById).mockResolvedValue(
      experiment({
        status: "running",
        project: "proj",
        variations: ["Control", "Treatment"].map((name, index) => ({
          id: String(index),
          key: String(index),
          name,
          screenshots: [],
        })),
        goalMetrics: ["goal"],
        secondaryMetrics: ["secondary"],
        guardrailMetrics: ["guardrail"],
      }),
    );
  });

  it.each([
    { analysis: 0.01, project: 0.05, org: 0.1, sig: false },
    { analysis: 0.05, project: 0.01, org: 0.01, sig: true },
    { analysis: undefined, project: 0.01, org: 0.05, sig: false },
    { analysis: undefined, project: undefined, org: 0.01, sig: false },
    { analysis: undefined, project: undefined, org: undefined, sig: true },
  ])(
    "resolves p-value settings for p=0.03: %j",
    async ({ analysis, project, org, sig }) => {
      context.org.settings = { pValueThreshold: org };
      getProjects.mockResolvedValue([
        {
          id: "proj",
          organization: "org",
          name: "Project",
          description: "",
          dateCreated: new Date(),
          dateUpdated: new Date(),
          settings: { pValueThreshold: project },
        },
      ]);
      setResults({
        settings: { pValueThreshold: analysis },
        stats: { pValue: 0.03 },
      });
      const card = await buildExperimentCardData(context, "exp");
      expect(card?.secondary?.[0].sig).toBe(sig);
      expect(card?.guardrail?.[0].sig).toBe(sig);
    },
  );

  it.each([
    { pValue: 0.001, pValueAdjusted: 0.03, sig: false },
    { pValue: 0.03, pValueAdjusted: 0, sig: true },
    { pValue: 0.01, pValueAdjusted: undefined, sig: false },
  ])(
    "uses adjusted p-values and strict significance boundaries: %j",
    async ({ pValue, pValueAdjusted, sig }) => {
      setResults({
        settings: { pValueThreshold: 0.01 },
        stats: { pValue, pValueAdjusted, ciAdjusted: [-0.04, 0.24] },
      });
      const card = await buildExperimentCardData(context, "exp");
      expect(card?.secondary?.[0]).toMatchObject({
        sig,
        ci: { lo: -4, hi: 24, pt: 10 },
      });
      expect(card?.rows[0].ci).toEqual({ lo: -4, hi: 24, pt: 10 });
    },
  );

  it.each([
    { confidence: undefined, chanceToWin: 0.96, sig: true },
    { confidence: 0.99, chanceToWin: 0.96, sig: false },
    { confidence: 0.99, chanceToWin: 0.04, sig: false },
    { confidence: 0.99, chanceToWin: 0.995, sig: true },
    { confidence: 0.99, chanceToWin: 0.005, sig: true },
    { confidence: 0.99, chanceToWin: 0.99, sig: false },
    { confidence: 0.99, chanceToWin: 1 - 0.99, sig: false },
    { confidence: 0.99, chanceToWin: undefined, sig: false },
  ])(
    "uses configured Bayesian cutoffs: %j",
    async ({ confidence, chanceToWin, sig }) => {
      context.org.settings = { confidenceLevel: confidence };
      setResults({
        settings: { statsEngine: "bayesian" },
        stats: { chanceToWin, pValue: 0.001 },
      });
      const card = await buildExperimentCardData(context, "exp");
      expect(card?.secondary?.[0].sig).toBe(sig);
      expect(card?.guardrail?.[0].sig).toBe(sig);
    },
  );

  it("uses a project's Bayesian confidence level before the organization's", async () => {
    context.org.settings = { confidenceLevel: 0.9 };
    getProjects.mockResolvedValue([
      {
        id: "proj",
        organization: "org",
        name: "Project",
        description: "",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        settings: { confidenceLevel: 0.99 },
      },
    ]);
    setResults({
      settings: { statsEngine: "bayesian" },
      stats: { chanceToWin: 0.96 },
    });
    expect(
      (await buildExperimentCardData(context, "exp"))?.secondary?.[0].sig,
    ).toBe(false);
  });

  it.each(["running", "stopped"] as const)(
    "uses the configured SRM threshold on %s cards",
    async (status) => {
      jest.mocked(getExperimentById).mockResolvedValue(experiment({ status }));
      context.org.settings = { srmThreshold: 0.01 };
      setResults({ srm: 0.005 });
      const card = await buildExperimentCardData(context, "exp");
      if (status === "running") {
        expect(card).toMatchObject({ state: "warning", p: "p < 0.01" });
      } else {
        expect(card?.state).toBe("stopped");
        expect(card?.health?.issues[0][0]).toBe("Sample Ratio Mismatch");
      }
    },
  );

  it.each([
    { threshold: undefined, srm: 0.0005, state: "warning" },
    { threshold: undefined, srm: 0.001, state: "running" },
    { threshold: 0.0001, srm: 0.0005, state: "running" },
    { threshold: 0.01, srm: 0.01, state: "running" },
  ])(
    "preserves SRM defaults and strict boundaries: %j",
    async ({ threshold, srm, state }) => {
      context.org.settings = { srmThreshold: threshold };
      setResults({ srm });
      const card = await buildExperimentCardData(context, "exp");
      expect(card?.state).toBe(state);
      expect(card?.health).toBeUndefined();
    },
  );
});

it.each(["draft", "running", "stopped"] as const)(
  "expands metric groups before selection, limits, and snapshot lookup for %s cards",
  async (status) => {
    const goal = "fact__funnel?step=1";
    const secondary = [
      "fact__proportion",
      "met_slice?country=US",
      "fact__funnel?step=0",
      "s4",
    ];
    const guardrail = ["g1", "g2", "g3", "g4"];
    getMetricGroups.mockResolvedValue([
      metricGroup("mg_empty", []),
      metricGroup("mg_goal", [goal, "unused_goal"]),
      metricGroup("mg_secondary", secondary),
      metricGroup("mg_guardrail", guardrail),
    ]);
    jest.mocked(getExperimentById).mockResolvedValue(
      experiment({
        status,
        variations: ["Control", "Treatment"].map((name, index) => ({
          id: String(index),
          key: String(index),
          name,
          screenshots: [],
        })),
        goalMetrics: ["mg_empty", "mg_goal"],
        secondaryMetrics: ["mg_secondary", "outside_secondary"],
        guardrailMetrics: ["mg_guardrail", "outside_guardrail"],
      }),
    );
    const funnel = {
      ...proportion,
      numerator: null,
      id: "fact__funnel",
      name: "Checkout funnel",
      metricType: "funnel",
      funnelSettings: {
        steps: [
          {
            name: "Cart",
            factTableId: "table",
            rowFilters: [],
            optional: false,
          },
          {
            name: "Purchase",
            factTableId: "table",
            rowFilters: [],
            optional: false,
          },
        ],
      },
    } satisfies FunnelFactMetricInterface;
    jest
      .mocked(getExperimentMetricsByIds)
      .mockImplementation(async (ctx, ids) =>
        ids.map((id) =>
          id === funnel.id
            ? funnel
            : id === proportion.id
              ? proportion
              : metric(id),
        ),
      );
    setResults({ ids: [goal, ...secondary, ...guardrail] });
    const card = await buildExperimentCardData(context, "exp");
    expect(card?.goal).toBe("Checkout funnel: Purchase");
    const secondaryNames = [
      "Conversion",
      "Metric met_slice",
      "Checkout funnel: Cart",
    ];
    const guardrailNames = ["Metric g1", "Metric g2", "Metric g3"];
    if (status === "draft") {
      expect(card?.metrics?.secondary).toEqual([
        ...secondaryNames,
        "Metric s4",
        "Metric outside_secondary",
      ]);
      expect(card?.metrics?.guardrail).toEqual([
        ...guardrailNames,
        "Metric g4",
        "Metric outside_guardrail",
      ]);
      expect(getLatestSuccessfulSnapshot).not.toHaveBeenCalled();
    } else {
      expect(card?.rows).toHaveLength(1);
      expect(card?.rows[0]).toMatchObject({ v: "Treatment", chg: "+10%" });
      expect(card?.secondary?.map((m) => m.name)).toEqual(secondaryNames);
      expect(card?.secondary?.[0].vr).toBe("10%");
      expect(card?.guardrail?.map((m) => m.name)).toEqual(guardrailNames);
      expect(getExperimentMetricsByIds).toHaveBeenCalledWith(context, [
        "fact__funnel",
        "fact__proportion",
        "met_slice",
        "g1",
        "g2",
        "g3",
      ]);
    }
    expect(getExperimentMetricsByIds).toHaveBeenCalledTimes(1);
  },
);
