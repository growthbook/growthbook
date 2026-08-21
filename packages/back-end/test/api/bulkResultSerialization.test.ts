import { ExperimentMetricInterface } from "shared/experiments";
import { SnapshotMetric } from "shared/types/experiment-snapshot";
import {
  buildResultMetricNameResolver,
  toApiResultAnalysis,
} from "back-end/src/api/experiments/bulkResultSerialization";

describe("toApiResultAnalysis", () => {
  it("carries a stats-engine errorMessage into the analysis entry", () => {
    const data = {
      value: 0,
      cr: 0,
      users: 0,
      errorMessage: "singular matrix",
    } as SnapshotMetric;

    const analysis = toApiResultAnalysis("bayesian", "relative", data);

    expect(analysis.errorMessage).toBe("singular matrix");
    expect(analysis.numerator).toBe(0);
  });

  it("omits errorMessage when the metric computed successfully", () => {
    const data = { value: 5, cr: 0.5, users: 10 } as SnapshotMetric;

    const analysis = toApiResultAnalysis("bayesian", "relative", data);

    expect("errorMessage" in analysis).toBe(false);
  });
});

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
