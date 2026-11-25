import type { ExperimentInterface } from "shared/types/experiment";
import type { DataSourceInterface } from "shared/types/datasource";
import type { OrganizationInterface } from "shared/types/organization";
import type {
  ExperimentSnapshotAnalysis,
  SnapshotMetric,
} from "shared/types/experiment-snapshot";
import { enrichAnalysisResults } from "shared/experiments";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import { calculatePowerScalingFactor } from "shared/enterprise";
import {
  getDefaultExperimentAnalysisSettings,
  getSnapshotSettings,
} from "back-end/src/services/experiments";
import type { FactTableMap } from "back-end/src/models/FactTableModel";
import { mergeNewMetricsUpdateAnalyses } from "back-end/src/services/experimentResults/compute/analyzeSnapshot";
import { factMetricFactory } from "../factories/FactMetric.factory";
import { factTableFactory } from "../factories/FactTable.factory";

const datasource = {
  id: "ds_1",
  type: "postgres",
  settings: {
    queries: {
      exposure: [
        {
          id: "exposure_user",
          name: "Users",
          userIdType: "user_id",
          query: "SELECT * FROM exposures",
          dimensions: [],
        },
      ],
    },
  },
} as unknown as DataSourceInterface;
const factTableMap = new Map(
  [
    factTableFactory.build({ id: "ft_user", userIdTypes: ["user_id"] }),
    factTableFactory.build({ id: "ft_device", userIdTypes: ["device_id"] }),
  ].map((t) => [t.id, t]),
) as FactTableMap;
const metrics = [
  ...["fact__a", "fact__b", "fact__sec", "fact__c"].map((id) =>
    factMetricFactory.build({ id, numerator: { factTableId: "ft_user" } }),
  ),
  factMetricFactory.build({
    id: "fact__device",
    numerator: { factTableId: "ft_device" },
  }),
];

const experiment = (
  metricIds: Pick<ExperimentInterface, "goalMetrics" | "secondaryMetrics">,
) =>
  ({
    id: "exp_1",
    organization: "org_1",
    datasource: "ds_1",
    exposureQueryId: "exposure_user",
    type: "standard",
    variations: [{ name: "Control" }, { name: "Treatment" }],
    phases: [
      {
        dateStarted: new Date("2026-11-01T00:00:00Z"),
        variationWeights: [0.5, 0.5],
      },
    ],
    guardrailMetrics: [],
    metricOverrides: [],
    ...metricIds,
  }) as unknown as ExperimentInterface;

// What a full update planned for the experiment would store.
const planFullUpdate = (e: ExperimentInterface) => ({
  defaultAnalysis: getDefaultExperimentAnalysisSettings({
    statsEngine: "frequentist",
    experiment: e,
    organization: { settings: {} } as OrganizationInterface,
    metricGroups: [],
  }),
  settings: getSnapshotSettings({
    experiment: e,
    phaseIndex: 0,
    snapshotType: "standard",
    dimension: null,
    regressionAdjustmentEnabled: false,
    orgPriorSettings: undefined,
    orgDisabledPrecomputedDimensions: true,
    settingsForSnapshotMetrics: [],
    metricMap: new Map(metrics.map((m) => [m.id, m])),
    factTableMap,
    metricGroups: [],
    incrementalRefreshModel: null,
    datasource,
  }),
});

const powerInputs = {
  status: "successful",
  firstPeriodPairwiseSampleSize: 1000,
  sigmahat2Delta: 0.01,
  targetMDE: 0.1,
} as const;
const powerFor = (numGoalMetrics: number) => ({
  ...powerInputs,
  ...calculatePowerScalingFactor(powerInputs, {
    alpha: 0.05,
    numGoalMetrics,
    sequential: false,
    sequentialTuningParameter: DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
  }),
});

// fact__device can't be joined to the exposure identifier, so the snapshot
// settings leave it out of the goals.
describe("the goal count of a new-metrics update with a listed goal that can't be analyzed", () => {
  const goalMetrics = ["fact__a", "fact__b", "fact__device"];
  const root = planFullUpdate(
    experiment({ goalMetrics, secondaryMetrics: [] }),
  );
  // The parent's results as the full update's stats run enriched them.
  const parentAnalysis = {
    dateCreated: new Date(),
    status: "success",
    settings: root.defaultAnalysis,
    results: [
      {
        name: "",
        srm: 0.5,
        variations: [0, 1].map(() => ({
          users: 10,
          metrics: {
            fact__a: {
              cr: 1,
              users: 10,
              value: 10,
              power: powerInputs,
            } as unknown as SnapshotMetric,
          },
        })),
      },
    ],
  } as unknown as ExperimentSnapshotAnalysis;
  enrichAnalysisResults({
    results: parentAnalysis.results,
    analysisSettings: parentAnalysis.settings,
    snapshotSettings: root.settings,
  });

  const copiedPowerAfter = (
    e: ExperimentInterface,
    queriedMetricIds: string[],
  ) => {
    const plan = planFullUpdate(e);
    const [merged] = mergeNewMetricsUpdateAnalyses({
      analyses: [parentAnalysis],
      freshResults: [[]],
      analyzedMetricIds: new Set([...goalMetrics, ...queriedMetricIds]),
      newMetricIds: new Set(queriedMetricIds),
      variationWeights: [0.5, 0.5],
      goalMetrics: plan.settings.goalMetrics,
    });
    return merged.results[0].variations[1].metrics.fact__a.power;
  };

  it("counts the goals the snapshot analyzes, in a full update and a new-metrics update alike", () => {
    expect(root.settings.goalMetrics).toEqual(["fact__a", "fact__b"]);
    expect(
      parentAnalysis.results[0].variations[1].metrics.fact__a.power,
    ).toEqual(powerFor(2));
    expect(
      copiedPowerAfter(
        experiment({ goalMetrics, secondaryMetrics: ["fact__sec"] }),
        ["fact__sec"],
      ),
    ).toEqual(powerFor(2));
  });

  it("rescales copied power for the analyzed goals when a goal was added", () => {
    expect(
      copiedPowerAfter(
        experiment({
          goalMetrics: [...goalMetrics, "fact__c"],
          secondaryMetrics: [],
        }),
        ["fact__c"],
      ),
    ).toEqual(powerFor(3));
  });
});
