import { describe, expect, it } from "vitest";
import type { FactTableInterface } from "shared/types/fact-table";
import type {
  ExplorationConfig,
  JourneyDataset,
  ProductAnalyticsExploration,
  ProductAnalyticsResultRow,
} from "shared/validators";
import { projectJourneyRows } from "shared/journeys";
import {
  createEmptyDataset,
  fillMissingUnits,
  getDefaultJourneyStepColumns,
  getInitialInlineFilters,
  getMaxDimensions,
  hasSubmittablePayload,
  hasUnsatisfiedInlineFilters,
  compareConfig,
  isSubmittableConfig,
  journeyPreferredView,
  toFetchKey,
  withStepGroupsApplied,
} from "@/enterprise/components/ProductAnalytics/util";
import {
  buildJourneyViewModel,
  withHiddenJourneyDims,
} from "@/enterprise/components/ProductAnalytics/MainSection/useJourneyModel";
import { buildJourneyTableData } from "@/enterprise/components/ProductAnalytics/MainSection/useExplorationTableData";

function journeyDataset(
  overrides: Partial<JourneyDataset> = {},
): JourneyDataset {
  return {
    type: "journey",
    factTableId: "ft_events",
    unit: "user_id",
    stepColumns: ["event_name"],
    anchorStepValues: ["view"],
    direction: "forward",
    rowFilters: [],
    path: [],
    lookaheadDepth: 3,
    optionsPerStep: [],
    ...overrides,
  };
}

function pathRow(
  levels: string[],
  count: number,
  dim: string | null = null,
): ProductAnalyticsResultRow {
  return {
    dimensions: dim ? [dim] : [],
    journey: {
      kind: "path",
      direction: "forward",
      levels,
      count,
    },
  };
}

const heldRows: ProductAnalyticsResultRow[] = [
  pathRow(["home", "search", "(exit)"], 40),
  pathRow(["home", "(exit)", "(none)"], 10),
  pathRow(["search", "(exit)", "(none)"], 20),
  pathRow(["(exit)", "(none)", "(none)"], 30),
];

describe("journey util branches", () => {
  it("createEmptyDataset seeds journey defaults without values", () => {
    const dataset = createEmptyDataset("journey");
    expect(dataset.type).toBe("journey");
    expect(dataset).not.toHaveProperty("values");
    if (dataset.type !== "journey") throw new Error("expected journey");
    expect(dataset.lookaheadDepth).toBe(3);
    expect(dataset.optionsPerStep).toEqual([]);
  });

  it("fillMissingUnits defaults the unit from the fact table", () => {
    const config: ExplorationConfig = {
      type: "journey",
      datasource: "ds_1",
      chartType: "bar",
      dateRange: {
        predefined: "last7Days",
        startDate: null,
        endDate: null,
        lookbackValue: null,
        lookbackUnit: null,
      },
      dimensions: [],
      dataset: journeyDataset({ unit: null }),
    };
    const next = fillMissingUnits(
      config,
      () =>
        ({
          id: "ft_events",
          userIdTypes: ["user_id"],
          columns: [],
        }) as unknown as FactTableInterface,
      () => null,
    );
    if (next.dataset.type !== "journey") throw new Error("expected journey");
    expect(next.dataset.unit).toBe("user_id");
  });

  it("caps journeys at one dimension", () => {
    expect(getMaxDimensions(journeyDataset())).toBe(1);
  });

  it("journeyPreferredView forces SQL on empty+error and viz on empty", () => {
    expect(
      journeyPreferredView({
        chartType: "bar",
        hasData: false,
        hasError: true,
      }),
    ).toBe("table");
    expect(
      journeyPreferredView({
        chartType: "table",
        hasData: false,
        hasError: false,
      }),
    ).toBe("bar");
    expect(
      journeyPreferredView({
        chartType: "table",
        hasData: true,
        hasError: true,
      }),
    ).toBe("table");
    expect(
      journeyPreferredView({
        chartType: "bar",
        hasData: true,
        hasError: true,
      }),
    ).toBe("bar");
  });

  it("isSubmittableConfig requires fact table, unit, step columns, and starting step", () => {
    const complete = {
      type: "journey" as const,
      datasource: "ds_1",
      chartType: "bar" as const,
      dateRange: {
        predefined: "last7Days" as const,
        startDate: null,
        endDate: null,
        lookbackValue: null,
        lookbackUnit: null,
      },
      dimensions: [],
      dataset: journeyDataset(),
    };
    expect(isSubmittableConfig(complete)).toBe(true);
    expect(hasSubmittablePayload(complete)).toBe(true);

    const missingAnchor = {
      ...complete,
      dataset: journeyDataset({ anchorStepValues: null }),
    };
    expect(isSubmittableConfig(missingAnchor)).toBe(false);
  });

  it("toFetchKey includes path and drops render-only heightScale", () => {
    const config = {
      type: "journey" as const,
      datasource: "ds_1",
      chartType: "bar" as const,
      dateRange: {
        predefined: "last7Days" as const,
        startDate: null,
        endDate: null,
        lookbackValue: null,
        lookbackUnit: null,
      },
      dimensions: [],
      dataset: journeyDataset({
        path: [{ value: "search" }],
        heightScale: "absolute",
      }),
    };
    const key = toFetchKey(config) as {
      dataset: {
        type: string;
        lookaheadDepth?: number;
        path?: unknown;
        heightScale?: unknown;
      };
    };
    expect(key.dataset.type).toBe("journey");
    expect(key.dataset.lookaheadDepth).toBe(3);
    expect(key.dataset.path).toEqual([{ value: "search" }]);
    expect(key.dataset).not.toHaveProperty("heightScale");
  });

  it("compareConfig fetches when the path changes", () => {
    const submitted: ExplorationConfig = {
      type: "journey",
      datasource: "ds_1",
      chartType: "bar",
      dateRange: {
        predefined: "last7Days",
        startDate: null,
        endDate: null,
        lookbackValue: null,
        lookbackUnit: null,
      },
      dimensions: [],
      dataset: journeyDataset({ path: [], lookaheadDepth: 3 }),
    };
    const draft: ExplorationConfig = {
      ...submitted,
      dataset: journeyDataset({
        path: [{ value: "home" }],
        lookaheadDepth: 3,
      }),
    };
    expect(compareConfig(submitted, draft)).toEqual({
      needsFetch: true,
      needsUpdate: true,
    });
  });

  it("toFetchKey keeps stepGroups, which change the generated SQL", () => {
    const withGroups = {
      type: "journey" as const,
      datasource: "ds_1",
      chartType: "bar" as const,
      dateRange: {
        predefined: "last7Days" as const,
        startDate: null,
        endDate: null,
        lookbackValue: null,
        lookbackUnit: null,
      },
      dimensions: [],
      dataset: journeyDataset({
        stepGroups: [{ column: "event_name", pattern: "/article/*" }],
      }),
    };
    const key = toFetchKey(withGroups) as {
      dataset: { stepGroups?: unknown };
    };
    expect(key.dataset.stepGroups).toEqual([
      { column: "event_name", pattern: "/article/*" },
    ]);
  });
});

describe("withStepGroupsApplied", () => {
  const rules = [{ column: "event_name", pattern: "/article/*" }];

  it("rewrites an anchor that a new rule now groups", () => {
    // Without this the anchor would match nothing and the chart would silently
    // render its no-anchor empty state.
    const next = withStepGroupsApplied(
      journeyDataset({ anchorStepValues: ["/article/123"] }),
      rules,
    );
    expect(next.anchorStepValues).toEqual(["/article/*"]);
    expect(next.stepGroups).toEqual(rules);
  });

  it("leaves an anchor no rule matches alone", () => {
    const next = withStepGroupsApplied(
      journeyDataset({ anchorStepValues: ["/search"] }),
      rules,
    );
    expect(next.anchorStepValues).toEqual(["/search"]);
  });

  it("rewrites each anchor value against its own column's rules", () => {
    const next = withStepGroupsApplied(
      journeyDataset({
        stepColumns: ["event_name", "category"],
        anchorStepValues: ["/article/1", "/article/1"],
      }),
      rules,
    );
    // Only event_name has a rule, so category keeps its raw value.
    expect(next.anchorStepValues).toEqual(["/article/*", "/article/1"]);
  });

  it("resets the drilled-down path", () => {
    const next = withStepGroupsApplied(
      journeyDataset({ path: [{ value: "/article/1" }] }),
      rules,
    );
    expect(next.path).toEqual([]);
  });

  it("tolerates a null anchor", () => {
    const next = withStepGroupsApplied(
      journeyDataset({ anchorStepValues: null }),
      rules,
    );
    expect(next.anchorStepValues).toBeNull();
  });

  it("clearing the rules leaves already-grouped values in place", () => {
    // Removing a rule cannot recover the raw values it collapsed, so the label
    // stays and the user re-picks it from the ungrouped list.
    const next = withStepGroupsApplied(
      journeyDataset({ anchorStepValues: ["/article/*"] }),
      [],
    );
    expect(next.stepGroups).toEqual([]);
    expect(next.anchorStepValues).toEqual(["/article/*"]);
  });
});

describe("journey alwaysInlineFilter columns", () => {
  function col(
    column: string,
    overrides: Partial<FactTableInterface["columns"][number]> = {},
  ): FactTableInterface["columns"][number] {
    return {
      column,
      datatype: "string",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      name: column,
      description: "",
      numberFormat: "",
      alwaysInlineFilter: false,
      deleted: false,
      autoSlices: [],
      isAutoSliceColumn: false,
      ...overrides,
    };
  }

  const eventsFt = {
    id: "ft_events",
    userIdTypes: ["user_id"],
    columns: [
      col("user_id"),
      col("event_name", { alwaysInlineFilter: true }),
      col("path", { alwaysInlineFilter: true }),
      col("country"),
    ],
  } as FactTableInterface;

  it("auto-selects alwaysInlineFilter string columns as step columns", () => {
    expect(getDefaultJourneyStepColumns(eventsFt)).toEqual([
      "event_name",
      "path",
    ]);
  });

  it("does not seed those columns as empty row filters", () => {
    const stepColumns = getDefaultJourneyStepColumns(eventsFt);
    expect(getInitialInlineFilters(eventsFt, [], stepColumns)).toEqual([]);
  });

  it("still seeds alwaysInlineFilter columns that are not step columns", () => {
    expect(getInitialInlineFilters(eventsFt, [], ["event_name"])).toEqual([
      { column: "path", operator: "=", values: [""] },
    ]);
  });

  it("does not block submit when the empty alwaysInlineFilter is a step column", () => {
    const config: ExplorationConfig = {
      type: "journey",
      datasource: "ds_1",
      chartType: "bar",
      dateRange: {
        predefined: "last7Days",
        startDate: null,
        endDate: null,
        lookbackValue: null,
        lookbackUnit: null,
      },
      dimensions: [],
      dataset: journeyDataset({
        stepColumns: ["event_name"],
        rowFilters: [{ column: "event_name", operator: "=", values: [""] }],
      }),
    };
    expect(
      hasUnsatisfiedInlineFilters(config, (id) =>
        id === "ft_events" ? eventsFt : null,
      ),
    ).toBe(false);
  });

  it("does block submit when a leftover alwaysInlineFilter is not a step column", () => {
    const config: ExplorationConfig = {
      type: "journey",
      datasource: "ds_1",
      chartType: "bar",
      dateRange: {
        predefined: "last7Days",
        startDate: null,
        endDate: null,
        lookbackValue: null,
        lookbackUnit: null,
      },
      dimensions: [],
      dataset: journeyDataset({
        stepColumns: ["country"],
        rowFilters: [{ column: "event_name", operator: "=", values: [""] }],
      }),
    };
    expect(
      hasUnsatisfiedInlineFilters(config, (id) =>
        id === "ft_events" ? eventsFt : null,
      ),
    ).toBe(true);
  });
});

describe("buildJourneyViewModel", () => {
  function displayRows(dataset: JourneyDataset) {
    return projectJourneyRows({
      cachedDataset: journeyDataset(),
      cachedRows: heldRows,
      requestedDataset: dataset,
    });
  }

  it("keeps the four count invariants on an empty path", () => {
    const dataset = journeyDataset();
    const model = buildJourneyViewModel({
      rows: displayRows(dataset),
      dataset,
      hasDimension: false,
    });
    expect(model.violations).toEqual([]);
    expect(model.matchedTotal).toBe(100);
    expect(model.anchorTotal).toBe(100);
    const frontier = model.columns.filter((c) => c.frontier);
    expect(frontier).toHaveLength(1);
    expect(frontier[0].nodes.reduce((a, n) => a + n.value, 0)).toBe(100);
  });

  it("renders a committed split and next frontier from projected rows", () => {
    const dataset = journeyDataset({ path: [{ value: "home" }] });
    const model = buildJourneyViewModel({
      rows: displayRows(dataset),
      dataset,
      hasDimension: false,
    });
    expect(model.violations).toEqual([]);
    expect(model.prefixCount[0]).toBe(100);
    expect(model.prefixCount[1]).toBe(50);
    const leak = model.leak[0];
    expect(leak.other + leak.exit + model.prefixCount[1]).toBe(
      model.prefixCount[0],
    );
    const frontier = model.columns.find((c) => c.frontier && c.fi === 0);
    expect(
      Object.fromEntries((frontier?.nodes ?? []).map((n) => [n.key, n.value])),
    ).toEqual({ search: 40, "(exit)": 10 });
  });

  it("keeps committed steps aligned after a second click", () => {
    const dataset = journeyDataset({
      path: [{ value: "home" }, { value: "search" }],
    });
    const model = buildJourneyViewModel({
      rows: displayRows(dataset),
      dataset,
      hasDimension: false,
    });
    expect(model.prefixCount[0]).toBe(100);
    expect(model.prefixCount[1]).toBe(50);
    expect(model.prefixCount[2]).toBe(40);
    const committed = model.columns.filter((c) => c.committed && !c.anchor);
    expect(committed).toHaveLength(2);
    expect(committed[0].nodes[0].value).toBe(50);
    expect(committed[1].nodes[0].value).toBe(40);
    expect(model.columns.filter((c) => c.frontier)).toHaveLength(1);
    expect(model.leak[0].exit).toBe(30);
    expect(model.leak[0].other).toBe(20);
  });

  it("renders the first-step frontier after popping back to an empty path", () => {
    const dataset = journeyDataset({ path: [] });
    const model = buildJourneyViewModel({
      rows: displayRows(dataset),
      dataset,
      hasDimension: false,
    });
    const frontier = model.columns.find((c) => c.frontier);
    const nodes = Object.fromEntries(
      (frontier?.nodes ?? []).map((n) => [n.key, n.value]),
    );
    expect(nodes.home).toBe(50);
    expect(nodes.search).toBe(20);
    expect(nodes["(exit)"]).toBe(30);
    expect(model.columns.filter((c) => c.committed && !c.anchor)).toHaveLength(
      0,
    );
  });

  it("renders committed drop-off from warehouse rows", () => {
    const model = buildJourneyViewModel({
      rows: [
        pathRow(["thanks"], 40),
        {
          dimensions: [],
          journey: {
            kind: "committed",
            direction: "forward",
            stepIndex: 0,
            value: "home",
            count: 50,
          },
        },
        {
          dimensions: [],
          journey: {
            kind: "committed",
            direction: "forward",
            stepIndex: 0,
            value: "(other)",
            count: 20,
          },
        },
        {
          dimensions: [],
          journey: {
            kind: "committed",
            direction: "forward",
            stepIndex: 0,
            value: "(exit)",
            count: 30,
          },
        },
        {
          dimensions: [],
          journey: {
            kind: "committed",
            direction: "forward",
            stepIndex: 1,
            value: "search",
            count: 40,
          },
        },
        {
          dimensions: [],
          journey: {
            kind: "committed",
            direction: "forward",
            stepIndex: 1,
            value: "(exit)",
            count: 10,
          },
        },
      ],
      dataset: journeyDataset({
        path: [{ value: "home" }, { value: "search" }],
      }),
      hasDimension: false,
    });
    expect(model.prefixCount[0]).toBe(100);
    expect(model.prefixCount[1]).toBe(50);
    expect(model.leak[0].exit).toBe(30);
    expect(model.leak[0].other).toBe(20);
    expect(model.prefixCount[2]).toBe(40);
  });
});

describe("withHiddenJourneyDims", () => {
  const dimRows: ProductAnalyticsResultRow[] = [
    pathRow(["home", "search", "(exit)"], 40, "US"),
    pathRow(["home", "(exit)", "(none)"], 10, "US"),
    pathRow(["search", "(exit)", "(none)"], 20, "UK"),
    pathRow(["(exit)", "(none)", "(none)"], 30, "UK"),
  ];

  it("returns the same model when nothing is hidden", () => {
    const model = buildJourneyViewModel({
      rows: dimRows,
      dataset: journeyDataset(),
      hasDimension: true,
    });
    expect(withHiddenJourneyDims(model, new Set())).toBe(model);
  });

  it("drops a hidden dimension from totals, nodes, and edges", () => {
    const model = buildJourneyViewModel({
      rows: dimRows,
      dataset: journeyDataset(),
      hasDimension: true,
    });
    expect(model.anchorTotal).toBe(100);
    expect(model.dimTop).toEqual(["US", "UK"]);

    const filtered = withHiddenJourneyDims(model, new Set(["US"]));
    expect(filtered.dimTop).toEqual(["US", "UK"]);
    expect(filtered.anchorTotal).toBe(50);

    const frontier = filtered.columns.find((c) => c.frontier);
    const nodes = Object.fromEntries(
      (frontier?.nodes ?? []).map((n) => [n.key, n.value]),
    );
    expect(nodes.home).toBeUndefined();
    expect(nodes.search).toBe(20);
    expect(nodes["(exit)"]).toBe(30);
    expect(filtered.edges.every((e) => !e.dims?.has("US"))).toBe(true);
  });
});

describe("buildJourneyTableData", () => {
  const submitted: ExplorationConfig = {
    type: "journey",
    datasource: "ds_1",
    chartType: "table",
    dateRange: {
      predefined: "last7Days",
      startDate: null,
      endDate: null,
      lookbackValue: null,
      lookbackUnit: null,
    },
    dimensions: [],
    dataset: journeyDataset({ lookaheadDepth: 3 }),
  };

  it("mirrors the displayed path plus one frontier column", () => {
    const withPath: ExplorationConfig = {
      ...submitted,
      dataset: journeyDataset({
        lookaheadDepth: 3,
        path: [{ value: "home" }],
      }),
    };
    const exploration = {
      config: withPath,
      result: {
        rows: [
          pathRow(["search"], 40),
          {
            dimensions: [],
            journey: {
              kind: "committed",
              direction: "forward",
              stepIndex: 0,
              value: "home",
              count: 50,
            },
          },
          {
            dimensions: [],
            journey: {
              kind: "committed",
              direction: "forward",
              stepIndex: 0,
              value: "(exit)",
              count: 30,
            },
          },
        ],
      },
    } as ProductAnalyticsExploration;
    const table = buildJourneyTableData(exploration, withPath);
    expect(table.orderedColumnKeys).toEqual(["step_1", "step_2", "journeys"]);
    expect(table.rowData).toEqual([
      {
        step_1: "(exit)",
        step_2: null,
        journeys: 30,
      },
      {
        step_1: "home",
        step_2: null,
        journeys: 50,
      },
      {
        step_1: "home",
        step_2: "search",
        journeys: 40,
      },
    ]);
  });
});
