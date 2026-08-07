import {
  buildPrevResolvedExpr,
  conversionWindowToSeconds,
} from "shared/funnels";
import {
  ExperimentMetricInterface,
  funnelStepMetricId,
  getAllExpandedMetricIdsFromExperiment,
  parseFunnelStepMetricId,
} from "shared/experiments";
import { FunnelFactMetricInterface } from "shared/types/fact-table";

describe("conversionWindowToSeconds", () => {
  it("converts each supported unit", () => {
    expect(conversionWindowToSeconds({ unit: "minutes", value: 30 })).toBe(
      1800,
    );
    expect(conversionWindowToSeconds({ unit: "hours", value: 2 })).toBe(7200);
    expect(conversionWindowToSeconds({ unit: "days", value: 3 })).toBe(259200);
    expect(conversionWindowToSeconds({ unit: "weeks", value: 1 })).toBe(604800);
  });

  it("rounds fractional values and never returns less than one unit", () => {
    expect(conversionWindowToSeconds({ unit: "hours", value: 1.4 })).toBe(3600);
    expect(conversionWindowToSeconds({ unit: "hours", value: 1.6 })).toBe(7200);
    expect(conversionWindowToSeconds({ unit: "hours", value: 0.1 })).toBe(3600);
  });
});

describe("buildPrevResolvedExpr", () => {
  const resolvedTsColumn = (i: number) => `step_${i}_resolved_ts`;

  it("anchors on the immediately preceding step when it is required", () => {
    expect(
      buildPrevResolvedExpr({
        steps: [{ optional: false }, { optional: false }, { optional: false }],
        index: 2,
        resolvedTsColumn,
      }),
    ).toBe("step_1_resolved_ts");
  });

  it("falls through optional steps back to the first required one", () => {
    expect(
      buildPrevResolvedExpr({
        steps: [
          { optional: false },
          { optional: true },
          { optional: true },
          { optional: false },
        ],
        index: 3,
        resolvedTsColumn,
      }),
    ).toBe(
      "COALESCE(step_2_resolved_ts, step_1_resolved_ts, step_0_resolved_ts)",
    );
  });

  it("stops at the first required step even if earlier ones are optional", () => {
    expect(
      buildPrevResolvedExpr({
        steps: [{ optional: true }, { optional: false }, { optional: true }],
        index: 2,
        resolvedTsColumn,
      }),
    ).toBe("step_1_resolved_ts");
  });

  it("qualifies columns with the table alias when given one", () => {
    expect(
      buildPrevResolvedExpr({
        steps: [{ optional: false }, { optional: true }, { optional: false }],
        index: 2,
        resolvedTsColumn,
        alias: "r",
      }),
    ).toBe("COALESCE(r.step_1_resolved_ts, r.step_0_resolved_ts)");
  });
});

describe("funnel step metric ids", () => {
  it("round-trips", () => {
    const id = funnelStepMetricId("fact__abc", 2);
    expect(id).toBe("fact__abc?step=2");
    expect(parseFunnelStepMetricId(id)).toEqual({
      isFunnelStepMetric: true,
      baseMetricId: "fact__abc",
      stepIndex: 2,
    });
  });

  it("leaves plain metric ids alone", () => {
    expect(parseFunnelStepMetricId("fact__abc")).toEqual({
      isFunnelStepMetric: false,
      baseMetricId: "fact__abc",
      stepIndex: null,
    });
  });

  it("does not treat slice metric ids as funnel steps", () => {
    expect(
      parseFunnelStepMetricId("fact__abc?dim:country=US").isFunnelStepMetric,
    ).toBe(false);
  });
});

describe("getAllExpandedMetricIdsFromExperiment funnel expansion", () => {
  const funnelMetric = {
    id: "fact__funnel",
    name: "Signup Funnel",
    metricType: "funnel",
    numerator: null,
    denominator: null,
    funnelSettings: {
      steps: [
        { name: "View", factTableId: "ft", rowFilters: [], optional: false },
        { name: "Signup", factTableId: "ft", rowFilters: [], optional: false },
      ],
    },
  } as unknown as FunnelFactMetricInterface;

  it("derives a step id per funnel step for a real funnel goal metric", () => {
    const ids = getAllExpandedMetricIdsFromExperiment({
      exp: { goalMetrics: [funnelMetric.id] },
      expandedMetricMap: new Map<string, ExperimentMetricInterface>([
        [funnelMetric.id, funnelMetric],
      ]),
    });
    expect(ids).toContain(funnelMetric.id);
    expect(ids).toContain(funnelStepMetricId(funnelMetric.id, 0));
    expect(ids).toContain(funnelStepMetricId(funnelMetric.id, 1));
  });
});
