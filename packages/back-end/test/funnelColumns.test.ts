import {
  funnelStepArrayColumn,
  funnelStepResolvedTsColumn,
  funnelStepSumColumn,
  funnelStepTimestampColumn,
  funnelStepValueColumn,
  parseFunnelStepSumColumn,
} from "back-end/src/integrations/sql/fact-metrics/funnel-columns";

describe("funnel step column names", () => {
  it("gives each column kind a distinct name for the same step", () => {
    const names = [
      funnelStepTimestampColumn("m0", 1),
      funnelStepArrayColumn("m0", 1),
      funnelStepResolvedTsColumn("m0", 1),
      funnelStepValueColumn("m0", 1),
      funnelStepSumColumn("m0", 1),
    ];
    expect(new Set(names).size).toBe(names.length);
  });

  it("scopes names by slot alias and step index", () => {
    expect(funnelStepValueColumn("m0", 1)).not.toBe(
      funnelStepValueColumn("m1", 1),
    );
    expect(funnelStepValueColumn("m0", 1)).not.toBe(
      funnelStepValueColumn("m0", 2),
    );
  });
});

describe("parseFunnelStepSumColumn", () => {
  // The parser re-describes the format funnelStepSumColumn builds, so a rename
  // on one side would otherwise silently drop every step from the results.
  it("round-trips names built by funnelStepSumColumn", () => {
    for (const alias of ["m0", "m12"]) {
      for (const stepIndex of [0, 3, 10]) {
        expect(
          parseFunnelStepSumColumn(funnelStepSumColumn(alias, stepIndex)),
        ).toEqual({ alias, stepIndex });
      }
    }
  });

  it("ignores the funnel's other per-step columns", () => {
    expect(parseFunnelStepSumColumn(funnelStepValueColumn("m0", 1))).toBeNull();
    expect(
      parseFunnelStepSumColumn(funnelStepResolvedTsColumn("m0", 1)),
    ).toBeNull();
    expect(parseFunnelStepSumColumn(funnelStepArrayColumn("m0", 1))).toBeNull();
    expect(
      parseFunnelStepSumColumn(funnelStepTimestampColumn("m0", 1)),
    ).toBeNull();
  });

  it("ignores non-funnel metric columns", () => {
    expect(parseFunnelStepSumColumn("m0_value")).toBeNull();
    expect(parseFunnelStepSumColumn("m0_denominator")).toBeNull();
    expect(parseFunnelStepSumColumn("variation")).toBeNull();
  });

  it("requires a well-formed slot alias and step index", () => {
    expect(parseFunnelStepSumColumn("x0_step_1_sum")).toBeNull();
    expect(parseFunnelStepSumColumn("m_step_1_sum")).toBeNull();
    expect(parseFunnelStepSumColumn("m0_step_x_sum")).toBeNull();
    expect(parseFunnelStepSumColumn("prefix_m0_step_1_sum")).toBeNull();
    expect(parseFunnelStepSumColumn("m0_step_1_sum_suffix")).toBeNull();
  });
});
