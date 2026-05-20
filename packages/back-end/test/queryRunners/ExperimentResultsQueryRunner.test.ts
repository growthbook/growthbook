import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { ExperimentMetricInterface } from "shared/experiments";
import { startExperimentResultQueries } from "back-end/src/queryRunners/ExperimentResultsQueryRunner";
import { getFactMetricGroups } from "back-end/src/services/experimentQueries/experimentQueries";
import { parseDimension } from "back-end/src/services/experiments";
import { orgHasPremiumFeature } from "back-end/src/enterprise";

jest.mock("back-end/src/services/experimentQueries/experimentQueries", () => ({
  getFactMetricGroups: jest.fn(),
}));

jest.mock("back-end/src/services/experiments", () => ({
  parseDimension: jest.fn(),
}));

jest.mock("back-end/src/enterprise", () => ({
  orgHasPremiumFeature: jest.fn(),
}));

function makeSnapshotSettings(
  overrides: Partial<ExperimentSnapshotSettings> = {},
): ExperimentSnapshotSettings {
  return {
    dimensions: [],
    precomputedUnitDimensionIds: ["dim_country"],
    metricSettings: [{ id: "fact_quantile" }] as never,
    goalMetrics: ["fact_quantile"],
    secondaryMetrics: [],
    guardrailMetrics: [],
    activationMetric: null,
    defaultMetricPriorSettings: {
      override: false,
      proper: false,
      mean: 0,
      stddev: 1,
    },
    regressionAdjustmentEnabled: false,
    attributionModel: "firstExposure",
    experimentId: "exp_1",
    queryFilter: "",
    segment: "",
    skipPartialData: false,
    datasourceId: "ds_1",
    exposureQueryId: "eq_1",
    startDate: new Date("2025-01-01T00:00:00Z"),
    endDate: new Date("2025-01-02T00:00:00Z"),
    variations: [
      { id: "0", weight: 0.5 },
      { id: "1", weight: 0.5 },
    ],
    ...overrides,
  };
}

describe("startExperimentResultQueries", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (orgHasPremiumFeature as jest.Mock).mockReturnValue(true);
    (parseDimension as jest.Mock).mockResolvedValue({
      type: "user",
      dimension: {
        id: "dim_country",
        datasource: "ds_1",
        userIdType: "user_id",
        sql: "SELECT user_id, country AS value FROM users",
      },
    });
  });

  it("does not group precomputed unit-dimension quantile metric queries by dimension", async () => {
    const quantileMetric = {
      id: "fact_quantile",
      metricType: "quantile",
      quantileSettings: {
        type: "unit",
        quantile: 0.9,
        ignoreZeros: false,
      },
    } as ExperimentMetricInterface;

    (getFactMetricGroups as jest.Mock).mockReturnValue({
      legacyMetricSingles: [quantileMetric],
      factMetricGroups: [[quantileMetric]],
    });

    const integration = {
      datasource: {
        id: "ds_1",
        settings: {
          pipelineSettings: {
            allowWriting: true,
            mode: "ephemeral",
            writeDataset: "gb",
          },
          queries: {
            exposure: [
              {
                id: "eq_1",
                name: "Assignment",
                userIdType: "user_id",
                query: "SELECT * FROM exposures",
                dimensions: [],
              },
            ],
          },
        },
      },
      getSourceProperties: () => ({
        supportsWritingTables: true,
        dropUnitsTable: false,
      }),
      generateTablePath: jest.fn(() => "gb.growthbook_tmp_units_snp_1"),
      getExperimentUnitsTableQuery: jest.fn(() => "units sql"),
      runExperimentUnitsQuery: jest.fn(),
      getExperimentMetricQuery: jest.fn(() => "metric sql"),
      runExperimentMetricQuery: jest.fn(),
      getExperimentFactMetricsQuery: jest.fn(() => "fact sql"),
      runExperimentFactMetricsQuery: jest.fn(),
    };
    const startQuery = jest.fn(async ({ name }) => {
      return { query: `query_${name}` } as never;
    });

    await startExperimentResultQueries(
      { org: { id: "org_1", settings: {} } } as never,
      {
        snapshotType: "standard",
        snapshotSettings: makeSnapshotSettings(),
        variationNames: ["Control", "Variation"],
        metricMap: new Map([["fact_quantile", quantileMetric]]),
        factTableMap: new Map(),
        queryParentId: "snp_1",
        experimentQueryMetadata: null,
      },
      integration as never,
      startQuery,
    );

    expect(integration.getExperimentUnitsTableQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        dimensions: [
          expect.objectContaining({
            dimension: expect.objectContaining({ id: "dim_country" }),
          }),
        ],
      }),
    );
    expect(
      integration.getExperimentMetricQuery.mock.calls[1][0].dimensions,
    ).toEqual([]);
    expect(
      integration.getExperimentFactMetricsQuery.mock.calls[1][0].dimensions,
    ).toEqual([]);
  });
});
