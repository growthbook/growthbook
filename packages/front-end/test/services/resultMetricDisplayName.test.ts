import { ExperimentMetricDefinition } from "shared/experiments";
import { FunnelFactMetricInterface } from "shared/types/fact-table";
import { getResultMetricDisplayName } from "@/services/experiments";

const funnelMetric = {
  id: "fact__funnel",
  name: "Signup Funnel",
  metricType: "funnel",
  numerator: null,
  denominator: null,
  funnelSettings: {
    steps: [
      { name: "View", factTableId: "ft_views", rowFilters: [] },
      { name: "Signup", factTableId: "ft_events", rowFilters: [] },
    ],
  },
} as unknown as FunnelFactMetricInterface;

const proportionMetric = {
  id: "fact__signups",
  name: "Signups",
  metricType: "proportion",
} as unknown as ExperimentMetricDefinition;

// Only stored metrics, as DefinitionsContext holds them: step and slice ids
// have no entry of their own and must be resolved from their parent.
const metricsById = new Map<string, ExperimentMetricDefinition>([
  [funnelMetric.id, funnelMetric],
  [proportionMetric.id, proportionMetric],
]);

const getExperimentMetricById = (id: string) => metricsById.get(id) ?? null;

describe("getResultMetricDisplayName", () => {
  it("names a plain metric", () => {
    expect(
      getResultMetricDisplayName("fact__signups", getExperimentMetricById),
    ).toBe("Signups");
  });

  it("names a funnel step after its step", () => {
    expect(
      getResultMetricDisplayName(
        "fact__funnel?step=1",
        getExperimentMetricById,
      ),
    ).toBe("Signup Funnel: Signup");
  });

  it("decorates a slice metric with its levels", () => {
    expect(
      getResultMetricDisplayName(
        "fact__signups?dim:country=US",
        getExperimentMetricById,
      ),
    ).toBe("Signups (country: US)");
    expect(
      getResultMetricDisplayName(
        "fact__signups?dim:country=",
        getExperimentMetricById,
      ),
    ).toBe("Signups (country: other)");
  });

  it("falls back to the raw id when nothing resolves", () => {
    expect(
      getResultMetricDisplayName("fact__gone", getExperimentMetricById),
    ).toBe("fact__gone");
    expect(
      getResultMetricDisplayName(
        "fact__gone?dim:country=US",
        getExperimentMetricById,
      ),
    ).toBe("fact__gone?dim:country=US");
    expect(
      getResultMetricDisplayName(
        "fact__funnel?step=9",
        getExperimentMetricById,
      ),
    ).toBe("fact__funnel?step=9");
    expect(
      getResultMetricDisplayName(
        "fact__signups?step=0",
        getExperimentMetricById,
      ),
    ).toBe("fact__signups?step=0");
  });
});
