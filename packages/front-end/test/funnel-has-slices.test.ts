import {
  FactTableDefinition,
  FunnelFactMetricInterface,
} from "shared/types/fact-table";
import { funnelMetricHasSlices } from "@/components/Experiment/FunnelStepSliceLink";

const makeFactTable = (
  id: string,
  overrides: Record<string, unknown> = {},
): FactTableDefinition =>
  ({
    id,
    columns: [
      {
        column: "browser",
        datatype: "string",
        deleted: false,
        isAutoSliceColumn: true,
        autoSlices: ["Chrome", "Safari"],
        ...overrides,
      },
    ],
    userIdTypes: [],
    userIdColumns: {},
  }) as unknown as FactTableDefinition;

const funnelMetric = {
  id: "fact__funnel",
  name: "Signup Funnel",
  metricType: "funnel",
  numerator: null,
  denominator: null,
  metricAutoSlices: ["browser"],
  funnelSettings: {
    steps: [
      { name: "View", factTableId: "ft_a", rowFilters: [], optional: false },
      { name: "Signup", factTableId: "ft_b", rowFilters: [], optional: false },
    ],
  },
} as unknown as FunnelFactMetricInterface;

const getFactTableById = (secondTableOverrides: Record<string, unknown>) => {
  const factTables = new Map([
    ["ft_a", makeFactTable("ft_a")],
    ["ft_b", makeFactTable("ft_b", secondTableOverrides)],
  ]);
  return (id: string) => factTables.get(id) ?? null;
};

describe("funnelMetricHasSlices", () => {
  it("is true when every step supports the Auto Slice column", () => {
    expect(
      funnelMetricHasSlices({
        metric: funnelMetric,
        getFactTableById: getFactTableById({}),
      }),
    ).toBe(true);
  });

  it("is false when a later step disables the column", () => {
    expect(
      funnelMetricHasSlices({
        metric: funnelMetric,
        getFactTableById: getFactTableById({ isAutoSliceColumn: false }),
      }),
    ).toBe(false);
  });

  it("is false for a funnel with no slices configured", () => {
    expect(
      funnelMetricHasSlices({
        metric: {
          ...funnelMetric,
          metricAutoSlices: [],
        } as unknown as FunnelFactMetricInterface,
        getFactTableById: getFactTableById({}),
      }),
    ).toBe(false);
  });

  it("is true when only a custom slice applies", () => {
    expect(
      funnelMetricHasSlices({
        metric: {
          ...funnelMetric,
          metricAutoSlices: [],
        } as unknown as FunnelFactMetricInterface,
        customMetricSlices: [
          { slices: [{ column: "browser", levels: ["Chrome"] }] },
        ],
        getFactTableById: getFactTableById({}),
      }),
    ).toBe(true);
  });

  it("is false for a non-funnel metric", () => {
    expect(
      funnelMetricHasSlices({
        metric: {
          ...funnelMetric,
          metricType: "proportion",
          funnelSettings: null,
          numerator: { factTableId: "ft_a", column: "$$distinctUsers" },
        } as unknown as FunnelFactMetricInterface,
        getFactTableById: getFactTableById({}),
      }),
    ).toBe(false);
  });
});
