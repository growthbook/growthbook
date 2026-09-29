import { getScopedSettings } from "shared/settings";
import { ExperimentInterface } from "shared/types/experiment";
import { OrganizationInterface } from "shared/types/organization";
import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { resetExperimentBanditSettings } from "back-end/src/services/experiments";
import { getFactMetricGroups } from "back-end/src/services/experimentQueries/experimentQueries";
import { factMetricFactory } from "../factories/FactMetric.factory";

describe("capping eligibility", () => {
  const organization = { settings: {} } as OrganizationInterface;
  const { settings } = getScopedSettings({ organization });

  it.each(["cappingSettings", "lowerCappingSettings"] as const)(
    "excludes a goal with %s percentile capping from Bandits",
    (tail) => {
      const metric = factMetricFactory.build({
        cappingSettings: { type: "", value: 0 },
        [tail]: { type: "percentile", value: 0.5 },
      });
      const experiment = {
        datasource: "ds",
        goalMetrics: [metric.id],
        phases: [{ dateStarted: new Date(), variationWeights: [0.5, 0.5] }],
        variations: [{ id: "0" }, { id: "1" }],
      } as ExperimentInterface;
      expect(
        resetExperimentBanditSettings({
          experiment,
          metricMap: new Map([[metric.id, metric]]),
          settings,
        }).goalMetrics,
      ).toEqual([]);
      const uncapped = {
        ...metric,
        cappingSettings: { type: "" as const, value: 0 },
        lowerCappingSettings: null,
      };
      expect(
        resetExperimentBanditSettings({
          experiment,
          metricMap: new Map([[metric.id, uncapped]]),
          settings,
        }).goalMetrics,
      ).toEqual([metric.id]);
    },
  );

  it("respects datasource grouping restrictions for lower-only percentiles", () => {
    const integration = {
      datasource: { type: "growthbook_clickhouse" },
      getSourceProperties: () => ({
        canGroupPercentileCappedMetrics: false,
        maxColumns: 1000,
      }),
    } as unknown as SourceIntegrationInterface;
    const metrics = ["fact_a", "fact_b"].map((id) =>
      factMetricFactory.build({
        id,
        numerator: { factTableId: "ft_same" },
        cappingSettings: { type: "", value: 0 },
        lowerCappingSettings: { type: "percentile", value: 0.05 },
      }),
    );
    const querySettings = {
      metricSettings: [],
    } as unknown as ExperimentSnapshotSettings;
    expect(
      getFactMetricGroups(
        metrics,
        querySettings,
        integration,
        organization,
      ).factMetricGroups.map((group) => group.map((m) => m.id)),
    ).toEqual([["fact_a"], ["fact_b"]]);
    expect(
      getFactMetricGroups(
        metrics.map((m) => ({ ...m, lowerCappingSettings: null })),
        querySettings,
        integration,
        organization,
      ).factMetricGroups.map((group) => group.map((m) => m.id)),
    ).toEqual([["fact_a", "fact_b"]]);
  });
});
