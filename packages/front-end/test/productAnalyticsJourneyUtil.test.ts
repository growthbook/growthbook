import { describe, expect, it } from "vitest";
import type { FactTableInterface } from "shared/types/fact-table";
import type {
  ExplorationConfig,
  JourneyDataset,
  ProductAnalyticsResultRow,
} from "shared/validators";
import {
  createEmptyDataset,
  getDefaultJourneyStepColumns,
  getInitialInlineFilters,
  getMaxDimensions,
  hasSubmittablePayload,
  hasUnsatisfiedInlineFilters,
  isSubmittableConfig,
  journeyPreferredView,
  toFetchKey,
  withStepGroupsApplied,
} from "@/enterprise/components/ProductAnalytics/util";
import { buildJourneyViewModel } from "@/enterprise/components/ProductAnalytics/MainSection/useJourneyModel";

function journeyDataset(
  overrides: Partial<JourneyDataset> = {},
): JourneyDataset {
  return {
    type: "journey",
    factTableId: "ft_events",
    unit: "user_id",
    dailyJourneys: false,
    stepColumns: ["event_name"],
    anchorStepValues: ["view"],
    direction: "forward",
    excludedSteps: [],
    rowFilters: [],
    collapseRepeats: true,
    path: [],
    depth: 3,
    optionsPerStep: [],
    renderDepth: 2,
    scaleMode: "perStep",
    dimEncoding: "tooltip",
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

function progressRow(
  depthReached: number,
  outcome: "taken" | "other" | "exit",
  count: number,
): ProductAnalyticsResultRow {
  return {
    dimensions: [],
    journey: {
      kind: "progress",
      direction: "forward",
      depthReached,
      outcome,
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
    expect(dataset.depth).toBe(3);
    expect(dataset.renderDepth).toBe(2);
    expect(dataset.optionsPerStep).toEqual([]);
    expect(dataset.collapseRepeats).toBe(true);
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

  it("toFetchKey strips display-only journey fields", () => {
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
        renderDepth: 2,
        scaleMode: "funnel",
        dimEncoding: "ribbons",
      }),
    };
    const key = toFetchKey(config) as {
      dataset: { type: string; depth?: number; path?: unknown };
    };
    expect(key.dataset).not.toHaveProperty("renderDepth");
    expect(key.dataset).not.toHaveProperty("scaleMode");
    expect(key.dataset).not.toHaveProperty("dimEncoding");
    expect(key.dataset.type).toBe("journey");
    expect(key.dataset.depth).toBe(3);
    expect(key.dataset.path).toEqual([]);
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

  it("rewrites and dedupes excluded steps", () => {
    const next = withStepGroupsApplied(
      journeyDataset({
        excludedSteps: ["/article/1", "/article/2", "/ping"],
      }),
      rules,
    );
    expect(next.excludedSteps).toEqual(["/article/*", "/ping"]);
  });

  it("resets the drilled-down path", () => {
    const next = withStepGroupsApplied(
      journeyDataset({ path: [{ mode: "value", value: "/article/1" }] }),
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
  it("keeps the four count invariants on an empty path", () => {
    const model = buildJourneyViewModel({
      rows: heldRows,
      dataset: journeyDataset(),
      submittedPathLength: 0,
      hasDimension: false,
    });
    expect(model.violations).toEqual([]);
    expect(model.matchedTotal).toBe(100);
    expect(model.anchorTotal).toBe(100);
    const frontier = model.columns.filter((c) => c.frontier);
    expect(frontier[0].nodes.reduce((a, n) => a + n.value, 0)).toBe(100);
    const home = frontier[0].nodes.find((n) => n.key === "home");
    const homeChildren = model.edges
      .filter((e) => e.srcKey === "home" && e.fi === 1)
      .reduce((a, e) => a + e.value, 0);
    expect(homeChildren).toBe(home?.value);
  });

  it("splits a client-side commit three ways and matches a fresh query", () => {
    const client = buildJourneyViewModel({
      rows: heldRows,
      dataset: journeyDataset({
        path: [{ mode: "value", value: "home" }],
      }),
      submittedPathLength: 0,
      hasDimension: false,
    });
    expect(client.violations).toEqual([]);
    expect(client.prefixCount[0]).toBe(100);
    expect(client.prefixCount[1]).toBe(50);
    const leak = client.leak[0];
    expect(leak.other + leak.exit + client.prefixCount[1]).toBe(
      client.prefixCount[0],
    );

    const freshRows = heldRows
      .filter(
        (r) => r.journey?.kind === "path" && r.journey.levels[0] === "home",
      )
      .map((r) => {
        if (r.journey?.kind !== "path") return r;
        return {
          ...r,
          journey: {
            ...r.journey,
            levels: r.journey.levels.slice(1),
          },
        };
      });
    const fresh = buildJourneyViewModel({
      rows: [
        ...freshRows,
        progressRow(0, "other", 20),
        progressRow(0, "exit", 30),
        progressRow(1, "taken", 50),
      ],
      dataset: journeyDataset({
        path: [{ mode: "value", value: "home" }],
      }),
      submittedPathLength: 1,
      hasDimension: false,
    });
    expect(fresh.violations).toEqual([]);
    const clientFrontier = client.columns.find((c) => c.frontier && c.fi === 0);
    const freshFrontier = fresh.columns.find((c) => c.frontier && c.fi === 0);
    const clientNodes = Object.fromEntries(
      (clientFrontier?.nodes ?? []).map((n) => [n.key, n.value]),
    );
    const freshNodes = Object.fromEntries(
      (freshFrontier?.nodes ?? []).map((n) => [n.key, n.value]),
    );
    expect(clientNodes).toEqual(freshNodes);
    expect(client.matchedTotal).toBe(fresh.matchedTotal);
  });
});
