import { ExperimentMetricInterface } from "shared/experiments";
import { buildResultMetricNameResolver } from "back-end/src/api/experiments/bulkResultSerialization";

describe("buildResultMetricNameResolver", () => {
  const funnelMetric = {
    id: "fact__funnel",
    name: "Signup Funnel",
    metricType: "funnel",
    funnelSettings: {
      steps: [
        { name: "View", factTableId: "ft_views", rowFilters: [] },
        { name: "Signup", factTableId: "ft_events", rowFilters: [] },
      ],
    },
  } as unknown as ExperimentMetricInterface;

  const proportionMetric = {
    id: "fact__signups",
    name: "Signups",
    metricType: "proportion",
  } as unknown as ExperimentMetricInterface;

  const metricsById = new Map([
    [funnelMetric.id, funnelMetric],
    [proportionMetric.id, proportionMetric],
  ]);

  function resolve(ids: string[]): (string | undefined)[] {
    const getName = buildResultMetricNameResolver(ids, metricsById);
    return ids.map(getName);
  }

  it("names each funnel step distinctly", () => {
    expect(resolve(["fact__funnel?step=0", "fact__funnel?step=1"])).toEqual([
      "Signup Funnel: View",
      "Signup Funnel: Signup",
    ]);
  });

  it("names the funnel itself and its steps", () => {
    expect(resolve(["fact__funnel", "fact__funnel?step=0"])).toEqual([
      "Signup Funnel",
      "Signup Funnel: View",
    ]);
  });

  it("returns undefined for a step the funnel no longer has", () => {
    expect(resolve(["fact__funnel?step=9"])).toEqual([undefined]);
  });

  it("still decorates slice metrics with their levels", () => {
    expect(
      resolve(["fact__signups?dim:country=US", "fact__signups?dim:country="]),
    ).toEqual(["Signups (country: US)", "Signups (country: other)"]);
  });

  it("returns undefined for metrics missing from the map", () => {
    expect(resolve(["fact__gone", "fact__gone?step=0"])).toEqual([
      undefined,
      undefined,
    ]);
  });
});
