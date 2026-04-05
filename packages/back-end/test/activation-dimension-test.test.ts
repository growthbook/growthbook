/**
 * Test to verify activation dimension SQL generation
 *
 * These tests verify the bug fix for issue #4789 where users should be classified as
 * "Not Activated" if their first_activation_timestamp is after the experiment's
 * evaluation window.
 */
import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { ExperimentMetricInterface } from "shared/experiments";
import { DataSourceInterface } from "shared/types/datasource";
import { ExperimentAggregateUnitsQueryParams } from "back-end/src/types/Integration";
import BigQuery from "back-end/src/integrations/BigQuery";

describe("Activation Dimension SQL Generation", () => {
  // Common test setup
  const createMockSettings = (): ExperimentSnapshotSettings => ({
    experimentId: "test_exp_1",
    startDate: new Date("2024-01-01"),
    endDate: new Date("2024-01-31"),
    attributionModel: "experimentDuration" as const,
    regressionAdjustmentEnabled: false,
    exposureQueryId: "user_id",
    queryFilter: "",
    variations: [
      { id: "control", name: "Control" },
      { id: "variant", name: "Variant" },
    ],
    banditSettings: null,
    metricSettings: [],
  });

  const createMockActivationMetric = (): ExperimentMetricInterface =>
    ({
      id: "metric_activation_1",
      name: "SignUp Event",
      type: "count" as const,
      windowSettings: {
        type: "conversion" as const,
        windowUnit: "hours" as const,
        windowValue: 72,
        delayUnit: "hours" as const,
        delayValue: 0,
      },
    }) as unknown as ExperimentMetricInterface;

  const createBigQueryIntegration = (): BigQuery => {
    const mockContext = {
      permissions: {
        canUpdateDatasource: () => true,
      },
    };
    const integration = new BigQuery("", mockContext);
    integration.datasource = {
      id: "ds-1",
      type: "bigquery",
      settings: {
        queries: {
          exposure: [
            {
              id: "user_id",
              name: "User Exposure",
              userIdType: "user_id",
              query:
                "SELECT user_id, timestamp, experiment_id, variation_id FROM exposure_table",
              dimensions: [],
            },
          ],
        },
      },
    } as unknown as DataSourceInterface;
    return integration;
  };

  it("Generated SQL contains correct date boundary condition for activation dimension", () => {
    const bqIntegration = createBigQueryIntegration();
    const settings = createMockSettings();
    const activationMetric = createMockActivationMetric();

    const query = bqIntegration.getExperimentAggregateUnitsQuery({
      settings,
      activationMetric,
      segment: null,
      factTableMap: new Map(),
      dimensions: [],
      useUnitsTable: false,
      unitsTableFullName: "",
    } as unknown as ExperimentAggregateUnitsQueryParams);

    // Verify the activation dimension logic is present
    expect(query).toContain("first_activation_timestamp");
    expect(query).toContain("dim_activated");

    // Verify the CASE statement contains the boundary condition
    expect(query).toContain("'Activated'");
    expect(query).toContain("'Not Activated'");
    expect(query).toMatch(/CASE|IF|WHEN/i);

    // Core bug fix for issue #4789: timestamp boundary condition
    // Users with first_activation_timestamp after experiment end should be "Not Activated"
    expect(query).toContain("first_activation_timestamp IS NULL");
    expect(query).toContain("first_activation_timestamp >");
  });

  it("Should not generate dim_activated column when activation metric is not provided", () => {
    const bqIntegration = createBigQueryIntegration();
    const settings = createMockSettings();

    const query = bqIntegration.getExperimentAggregateUnitsQuery({
      settings,
      activationMetric: null,
      segment: null,
      factTableMap: new Map(),
      dimensions: [],
      useUnitsTable: false,
      unitsTableFullName: "",
    } as unknown as ExperimentAggregateUnitsQueryParams);

    // Without activation metric, dim_activated column should not be generated
    expect(query).not.toContain("dim_activated");
    expect(query).not.toContain("'Not Activated'");
    expect(query).not.toContain("'Activated'");
  });
});
