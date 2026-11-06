import {
  expandDerivedMetricsInMap,
  ExperimentMetricInterface,
  funnelStepMetricId,
  getSliceDataForMetric,
} from "shared/experiments";
import {
  ColumnInterface,
  FactMetricInterface,
  FactTableDefinition,
  FunnelFactMetricInterface,
} from "shared/types/fact-table";

const makeColumn = (
  overrides: Partial<ColumnInterface> = {},
): ColumnInterface =>
  ({
    column: "country",
    name: "Country",
    datatype: "string",
    deleted: false,
    isAutoSliceColumn: true,
    autoSlices: ["US", "CA"],
    ...overrides,
  }) as ColumnInterface;

const makeFactTable = (
  id: string,
  columns: ColumnInterface[],
): FactTableDefinition =>
  ({
    id,
    columns,
    userIdTypes: ["user_id"],
    userIdColumns: {},
  }) as unknown as FactTableDefinition;

const meanMetric = {
  id: "fact__revenue",
  name: "Revenue",
  metricType: "mean",
  numerator: { factTableId: "ft_views", column: "amount" },
  denominator: null,
  metricAutoSlices: ["country"],
} as unknown as FactMetricInterface;

const funnelMetric = {
  id: "fact__funnel",
  name: "Signup Funnel",
  metricType: "funnel",
  numerator: null,
  denominator: null,
  metricAutoSlices: ["country"],
  funnelSettings: {
    steps: [
      {
        name: "View",
        factTableId: "ft_views",
        rowFilters: [],
        optional: false,
      },
      {
        name: "Signup",
        factTableId: "ft_events",
        rowFilters: [],
        optional: false,
      },
    ],
  },
} as unknown as FunnelFactMetricInterface;

// The front end builds slice rows from getSliceDataForMetric and the back end
// builds the metrics it computes from expandDerivedMetricsInMap. Both read the
// same generator, and these assert they agree - a mismatch is what put "no
// data" slice rows in the drilldown.
function expandedSliceIds({
  metric,
  factTableMap,
  customMetricSlices,
}: {
  metric: ExperimentMetricInterface;
  factTableMap: Map<string, FactTableDefinition>;
  customMetricSlices?: { slices: { column: string; levels: string[] }[] }[];
}): string[] {
  const metricMap = new Map<string, ExperimentMetricInterface>([
    [metric.id, metric],
  ]);
  expandDerivedMetricsInMap({
    metricMap,
    factTableMap,
    experiment: { goalMetrics: [metric.id], customMetricSlices },
  });
  return [...metricMap.keys()].filter(
    (id) => id.includes("dim:") && !id.includes("step="),
  );
}

function sliceIds({
  metric,
  factTableMap,
  customMetricSlices,
}: {
  metric: ExperimentMetricInterface;
  factTableMap: Map<string, FactTableDefinition>;
  customMetricSlices?: { slices: { column: string; levels: string[] }[] }[];
}): string[] {
  return getSliceDataForMetric({
    metric,
    metricName: metric.name,
    customMetricSlices,
    getFactTable: (id) => factTableMap.get(id),
  }).map((slice) => slice.id);
}

describe("slice generation parity", () => {
  it.each([
    [
      "a mean metric's auto slices",
      {
        metric: meanMetric,
        factTableMap: new Map([
          ["ft_views", makeFactTable("ft_views", [makeColumn()])],
        ]),
      },
    ],
    [
      "a funnel whose steps agree",
      {
        metric: funnelMetric,
        factTableMap: new Map([
          ["ft_views", makeFactTable("ft_views", [makeColumn()])],
          ["ft_events", makeFactTable("ft_events", [makeColumn()])],
        ]),
      },
    ],
    [
      "a funnel whose steps carry different levels",
      {
        metric: funnelMetric,
        factTableMap: new Map([
          ["ft_views", makeFactTable("ft_views", [makeColumn()])],
          [
            "ft_events",
            makeFactTable("ft_events", [
              makeColumn({ autoSlices: ["US", "GB"] }),
            ]),
          ],
        ]),
      },
    ],
    [
      "a funnel whose later step disables the column",
      {
        metric: funnelMetric,
        factTableMap: new Map([
          ["ft_views", makeFactTable("ft_views", [makeColumn()])],
          [
            "ft_events",
            makeFactTable("ft_events", [
              makeColumn({ isAutoSliceColumn: false }),
            ]),
          ],
        ]),
      },
    ],
    [
      "custom slices on a funnel",
      {
        metric: funnelMetric,
        factTableMap: new Map([
          ["ft_views", makeFactTable("ft_views", [makeColumn()])],
          ["ft_events", makeFactTable("ft_events", [makeColumn()])],
        ]),
        customMetricSlices: [
          { slices: [{ column: "country", levels: ["FR"] }] },
        ],
      },
    ],
    [
      "custom slices naming a column a later step lacks",
      {
        metric: funnelMetric,
        factTableMap: new Map([
          ["ft_views", makeFactTable("ft_views", [makeColumn()])],
          ["ft_events", makeFactTable("ft_events", [])],
        ]),
        customMetricSlices: [
          { slices: [{ column: "country", levels: ["FR"] }] },
        ],
      },
    ],
  ])("agrees on %s", (_, input) => {
    expect(sliceIds(input).sort()).toEqual(expandedSliceIds(input).sort());
  });

  it('drops the "other" bucket when a funnel\'s step levels differ', () => {
    const input = {
      metric: funnelMetric,
      factTableMap: new Map([
        ["ft_views", makeFactTable("ft_views", [makeColumn()])],
        [
          "ft_events",
          makeFactTable("ft_events", [
            makeColumn({ autoSlices: ["US", "GB"] }),
          ]),
        ],
      ]),
    };

    expect(sliceIds(input)).toEqual([
      `${funnelMetric.id}?dim:country=US`,
      `${funnelMetric.id}?dim:country=CA`,
    ]);
  });

  it("expands every surviving funnel slice into step metrics", () => {
    const metricMap = new Map<string, ExperimentMetricInterface>([
      [funnelMetric.id, funnelMetric],
    ]);
    expandDerivedMetricsInMap({
      metricMap,
      factTableMap: new Map([
        ["ft_views", makeFactTable("ft_views", [makeColumn()])],
        ["ft_events", makeFactTable("ft_events", [makeColumn()])],
      ]),
      experiment: { goalMetrics: [funnelMetric.id] },
    });

    const sliceId = `${funnelMetric.id}?dim:country=US`;
    expect(metricMap.has(sliceId)).toBe(true);
    expect(metricMap.has(funnelStepMetricId(sliceId, 0))).toBe(true);
    expect(metricMap.has(funnelStepMetricId(sliceId, 1))).toBe(true);
  });

  it("leaves the caller's custom slice groups unsorted", () => {
    const slices = [
      { column: "country", levels: ["FR"] },
      { column: "browser", levels: ["chrome"] },
    ];
    getSliceDataForMetric({
      metric: meanMetric,
      metricName: meanMetric.name,
      customMetricSlices: [{ slices }],
      getFactTable: () => makeFactTable("ft_views", [makeColumn()]),
    });

    expect(slices.map((slice) => slice.column)).toEqual(["country", "browser"]);
  });
});
