import {
  ExperimentSnapshotHealth,
  ExperimentSnapshotInterface,
  ExperimentSnapshotTraffic,
} from "shared/types/experiment-snapshot";
import { ExperimentHealthSettings } from "shared/types/experiment";
import { toApiResultHealth } from "back-end/src/api/experiments/resultHealth";
import { toApiExperimentDecision } from "back-end/src/api/experiments/experimentDecision";

const healthSettings: ExperimentHealthSettings = {
  decisionFrameworkEnabled: false,
  srmThreshold: 0.001,
  multipleExposureMinPercent: 0.01,
  clusterIssueMinPercent: 0.01,
  experimentMinLengthDays: 7,
};

function makeTraffic(
  srm: number,
  variationUnits: number[],
): ExperimentSnapshotTraffic {
  return { overall: { name: "All", srm, variationUnits }, dimension: {} };
}

function makeSnapshot(
  overrides: Partial<ExperimentSnapshotInterface> = {},
): ExperimentSnapshotInterface {
  return {
    settings: {
      variations: [
        { id: "0", weight: 0.5 },
        { id: "1", weight: 0.5 },
      ],
    },
    type: "standard",
    unknownVariations: [],
    multipleExposures: 0,
    analyses: [],
    ...overrides,
  } as ExperimentSnapshotInterface;
}

const experiment = { type: "standard" as const };

describe("toApiResultHealth", () => {
  it("judges SRM and multiple exposures against the org thresholds", () => {
    const health = toApiResultHealth({
      experiment,
      snapshot: makeSnapshot({
        multipleExposures: 5,
        health: { traffic: makeTraffic(0.0001, [6000, 4000]) },
      }),
      healthSettings,
    });

    expect(health.srm).toEqual({
      pValue: 0.0001,
      status: "unhealthy",
      threshold: 0.001,
      totalUnits: 10000,
      variationUnits: [6000, 4000],
    });
    expect(health.multipleExposures).toEqual({
      count: 5,
      totalUnits: 10000,
      percent: 0.0005,
      status: "healthy",
      threshold: 0.01,
    });
    expect(health.power).toBeNull();
    expect(health.covariateImbalance).toBeNull();
    expect(health.cluster).toBeNull();
  });

  it("does not judge either check on too few units", () => {
    const health = toApiResultHealth({
      experiment,
      snapshot: makeSnapshot({
        health: { traffic: makeTraffic(0.0001, [5, 1]) },
      }),
      healthSettings,
    });

    expect(health.srm?.status).toBe("not-enough-traffic");
    expect(health.multipleExposures?.status).toBe("not-enough-traffic");
  });

  it("returns neither check when the snapshot has no unit totals", () => {
    const health = toApiResultHealth({
      experiment,
      snapshot: makeSnapshot({ multipleExposures: 3 }),
      healthSettings,
    });

    expect(health.srm).toBeNull();
    expect(health.multipleExposures).toBeNull();
  });

  it("falls back to the overall analysis result without a traffic query", () => {
    const health = toApiResultHealth({
      experiment,
      snapshot: makeSnapshot({
        multipleExposures: 12,
        analyses: [
          {
            results: [
              {
                name: "",
                srm: 1,
                variations: [{ users: 500 }, { users: 500 }],
              },
            ],
          },
        ] as never,
      }),
      healthSettings,
    });

    expect(health.srm).toMatchObject({ pValue: 1, status: "healthy" });
    expect(health.multipleExposures).toEqual({
      count: 12,
      totalUnits: 1000,
      percent: 0.012,
      status: "unhealthy",
      threshold: 0.01,
    });
  });

  it("tests SRM on clusters and multiple exposures on sub-units", () => {
    const base = makeSnapshot();
    const health = toApiResultHealth({
      experiment,
      snapshot: makeSnapshot({
        settings: { ...base.settings, isClusterExperiment: true },
        multipleExposures: 40,
        health: {
          traffic: makeTraffic(0.5, [5000, 5000]),
          clusterTraffic: makeTraffic(0.2, [60, 40]),
          clusterAssignment: { totalClusters: 100, mixedClusters: 5 },
          clusterSubUnitMapping: { totalUnits: 10000, multiClusterUnits: 0 },
          subUnitMultipleExposures: {
            totalSubUnits: 10000,
            multipleExposedSubUnits: 400,
          },
        },
      }),
      healthSettings,
    });

    expect(health.srm).toMatchObject({
      pValue: 0.2,
      totalUnits: 100,
      variationUnits: [60, 40],
    });
    expect(health.multipleExposures).toMatchObject({
      count: 400,
      totalUnits: 10000,
      percent: 0.04,
      status: "unhealthy",
    });
    expect(health.cluster).toEqual({
      mixedAssignment: {
        totalClusters: 100,
        mixedClusters: 5,
        percent: 0.05,
        status: "unhealthy",
      },
      unitsInMultipleClusters: {
        totalUnits: 10000,
        multiClusterUnits: 0,
        percent: 0,
        status: "healthy",
      },
    });
  });

  it("reports power only when the calculation succeeded", () => {
    const powerFor = (power: ExperimentSnapshotHealth["power"]) =>
      toApiResultHealth({
        experiment,
        snapshot: makeSnapshot({
          health: { traffic: makeTraffic(1, [500, 500]), power },
        }),
        healthSettings,
      }).power;

    expect(
      powerFor({
        type: "error",
        isLowPowered: true,
        metricVariationPowerResults: [],
      }),
    ).toBeNull();
    expect(
      powerFor({
        type: "success",
        power: 0.5,
        isLowPowered: true,
        additionalDaysNeeded: Infinity,
        metricVariationPowerResults: [],
      }),
    ).toEqual({ isLowPowered: true, additionalDaysNeeded: null });
  });

  it("treats empty health parts as not computed", () => {
    const health = toApiResultHealth({
      experiment,
      snapshot: makeSnapshot({
        health: {
          traffic: makeTraffic(1, [500, 500]),
          power: {},
          covariateImbalance: {},
          clusterAssignment: {},
          clusterSubUnitMapping: {},
        } as never,
      }),
      healthSettings,
    });

    expect(health.power).toBeNull();
    expect(health.covariateImbalance).toBeNull();
    expect(health.cluster).toBeNull();
  });
});

describe("toApiExperimentDecision", () => {
  it("lists the failing checks for an unhealthy experiment", () => {
    expect(
      toApiExperimentDecision(
        {
          status: "unhealthy",
          unhealthyData: {
            srm: true,
            multipleExposures: { rawDecimal: 0.02, multipleExposedUsers: 20 },
          },
        },
        "SRM, Multiple exposures",
      ),
    ).toEqual({
      status: "unhealthy",
      reason: "SRM, Multiple exposures",
      unhealthyChecks: ["srm", "multipleExposures"],
    });
  });

  it("returns the variations and action behind a recommendation", () => {
    expect(
      toApiExperimentDecision(
        {
          status: "ship-now",
          variations: [
            {
              variationId: "var_1",
              decidingRule: { conditions: [], action: "ship" },
            },
          ],
          powerReached: true,
          sequentialUsed: false,
          scheduledEndPassed: false,
        },
        undefined,
      ),
    ).toEqual({
      status: "ship-now",
      variations: [{ variationId: "var_1", action: "ship" }],
      powerReached: true,
      sequentialUsed: false,
      scheduledEndPassed: false,
    });
  });

  it("returns days left and errored metrics for their statuses", () => {
    expect(
      toApiExperimentDecision({ status: "days-left", daysLeft: 12 }, "why"),
    ).toEqual({ status: "days-left", reason: "why", daysLeft: 12 });
    expect(
      toApiExperimentDecision(
        { status: "days-left", daysLeft: Infinity },
        undefined,
      ),
    ).toEqual({ status: "days-left", daysLeft: null });
    expect(
      toApiExperimentDecision(
        { status: "data-incomplete", erroredMetrics: ["met_1"] },
        undefined,
      ),
    ).toEqual({ status: "data-incomplete", erroredMetricIds: ["met_1"] });
  });
});
