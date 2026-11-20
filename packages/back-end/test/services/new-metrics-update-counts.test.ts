import type { ExperimentInterface } from "shared/types/experiment";
import type { DataSourceInterface } from "shared/types/datasource";
import type { OrganizationInterface } from "shared/types/organization";
import type {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotInterface,
  SnapshotMetric,
} from "shared/types/experiment-snapshot";
import { getStatsEngineAnalysisSettings } from "shared/experiments";
import {
  getDefaultExperimentAnalysisSettings,
  getSnapshotSettings,
} from "back-end/src/services/experiments";
import type { FactTableMap } from "back-end/src/models/FactTableModel";
import { mergeNewMetricsUpdateAnalyses } from "back-end/src/services/newMetricsUpdateExecution";
import { getNewMetricsUpdateLineage } from "back-end/src/services/newMetricsUpdatePlanning";
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

const withPower = {
  cr: 1,
  users: 10,
  value: 10,
  power: { status: "successful", targetMDE: 0.1 },
} as unknown as SnapshotMetric;

// fact__device can't be joined to the exposure identifier, so the snapshot
// settings leave it out of the goals while the analysis counts it.
describe("the goal counts of a new-metrics update with a listed goal that can't be analyzed", () => {
  const goalMetrics = ["fact__a", "fact__b", "fact__device"];
  const root = planFullUpdate(
    experiment({ goalMetrics, secondaryMetrics: [] }),
  );
  const parent = {
    id: "snp_root",
    type: "standard",
    dateCreated: new Date("2026-11-10T00:00:00Z"),
    runStarted: null,
    settings: root.settings,
  } as unknown as ExperimentSnapshotInterface;
  const parentAnalysis = {
    dateCreated: new Date(),
    status: "success",
    settings: root.defaultAnalysis,
    results: [
      {
        name: "",
        srm: 0.5,
        variations: [
          { users: 10, metrics: { fact__a: withPower } },
          { users: 10, metrics: { fact__a: withPower } },
        ],
      },
    ],
  } as unknown as ExperimentSnapshotAnalysis;

  const update = (e: ExperimentInterface, queriedMetricIds: string[]) => {
    const plan = planFullUpdate(e);
    const updateScope = getNewMetricsUpdateLineage(
      parent,
      queriedMetricIds,
      plan.defaultAnalysis,
    );
    const [merged] = mergeNewMetricsUpdateAnalyses({
      analyses: [parentAnalysis],
      freshResults: [[]],
      analyzedMetricIds: new Set([...goalMetrics, ...queriedMetricIds]),
      newMetricIds: new Set(queriedMetricIds),
      variationWeights: [0.5, 0.5],
      counts: updateScope.metricCounts,
      getCountsComputedWith: () => ({
        numGoalMetrics: root.defaultAnalysis.numGoalMetrics,
        numGuardrailMetrics: root.defaultAnalysis.numGuardrailMetrics,
      }),
    });
    return {
      settings: plan.settings,
      updateScope,
      copiedPower: merged.results[0].variations[1].metrics.fact__a.power,
    };
  };

  it("counts every listed goal, as a full update would", () => {
    const { settings, updateScope } = update(
      experiment({ goalMetrics, secondaryMetrics: ["fact__sec"] }),
      ["fact__sec"],
    );

    expect(settings.goalMetrics).toHaveLength(2);
    expect(updateScope.metricCounts).toEqual({
      numGoalMetrics: 3,
      numGuardrailMetrics: 0,
    });
    expect(
      getStatsEngineAnalysisSettings(
        { type: "standard", updateScope },
        parentAnalysis.settings,
      ),
    ).toMatchObject({ numGoalMetrics: 3, numGuardrailMetrics: 0 });
  });

  it("keeps copied power when only a secondary metric was added", () => {
    const { copiedPower } = update(
      experiment({ goalMetrics, secondaryMetrics: ["fact__sec"] }),
      ["fact__sec"],
    );

    expect(copiedPower).toEqual(withPower.power);
  });

  it("drops copied power when a goal was added", () => {
    const { updateScope, copiedPower } = update(
      experiment({
        goalMetrics: [...goalMetrics, "fact__c"],
        secondaryMetrics: [],
      }),
      ["fact__c"],
    );

    expect(updateScope.metricCounts.numGoalMetrics).toBe(4);
    expect(copiedPower).toBeUndefined();
  });
});
