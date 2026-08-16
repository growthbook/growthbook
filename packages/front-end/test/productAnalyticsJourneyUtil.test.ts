import { describe, expect, it } from "vitest";
import type { FactTableInterface } from "shared/types/fact-table";
import type {
  ExplorationConfig,
  JourneyDataset,
  ProductAnalyticsResultRow,
} from "shared/validators";
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
  journeyDiffersOnlyByPath,
  journeyPrefetchExhausted,
  journeyShouldPrefetchMore,
} from "@/enterprise/components/ProductAnalytics/journey-policy";
import {
  buildJourneyViewModel,
  buildJourneyViewState,
} from "@/enterprise/components/ProductAnalytics/MainSection/useJourneyModel";

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
    expect(dataset.renderDepth).toBe(1);
    expect(dataset.optionsPerStep).toEqual([]);
    expect(dataset.dailyJourneys).toBe(true);
    expect(dataset.collapseRepeats).toBe(true);
    expect(dataset.excludedSteps).toEqual([]);
  });

  it("fillMissingUnits forces daily journeys, collapse repeats, and no exclusions", () => {
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
        dailyJourneys: false,
        collapseRepeats: false,
        excludedSteps: ["heartbeat"],
      }),
    };
    const next = fillMissingUnits(
      config,
      () => null,
      () => null,
    );
    if (next.dataset.type !== "journey") throw new Error("expected journey");
    expect(next.dataset.dailyJourneys).toBe(true);
    expect(next.dataset.collapseRepeats).toBe(true);
    expect(next.dataset.excludedSteps).toEqual([]);
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
    expect(key.dataset).not.toHaveProperty("path");
  });

  it("journeyShouldPrefetchMore starts one step before the prefetch runs out", () => {
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
      dataset: journeyDataset({ path: [], depth: 3 }),
    };
    const withinPrefetch: ExplorationConfig = {
      ...submitted,
      dataset: journeyDataset({
        path: [{ mode: "value", value: "home" }],
        depth: 3,
      }),
    };
    const exhausted: ExplorationConfig = {
      ...submitted,
      dataset: journeyDataset({
        path: [
          { mode: "value", value: "home" },
          { mode: "value", value: "search" },
          { mode: "value", value: "checkout" },
        ],
        depth: 3,
      }),
    };
    const otherChange: ExplorationConfig = {
      ...exhausted,
      dataset: journeyDataset({
        path: [
          { mode: "value", value: "home" },
          { mode: "value", value: "search" },
          { mode: "value", value: "checkout" },
        ],
        depth: 3,
        unit: "anonymous_id",
      }),
    };
    const oneBefore: ExplorationConfig = {
      ...submitted,
      dataset: journeyDataset({
        path: [
          { mode: "value", value: "home" },
          { mode: "value", value: "search" },
        ],
        depth: 3,
      }),
    };
    expect(journeyDiffersOnlyByPath(submitted, withinPrefetch)).toBe(true);
    expect(journeyShouldPrefetchMore(submitted, withinPrefetch)).toBe(false);
    expect(
      journeyPrefetchExhausted(submitted.dataset, withinPrefetch.dataset),
    ).toBe(false);
    expect(journeyShouldPrefetchMore(submitted, oneBefore)).toBe(true);
    expect(journeyPrefetchExhausted(submitted.dataset, oneBefore.dataset)).toBe(
      false,
    );
    expect(journeyShouldPrefetchMore(submitted, exhausted)).toBe(true);
    expect(journeyPrefetchExhausted(submitted.dataset, exhausted.dataset)).toBe(
      true,
    );
    expect(journeyShouldPrefetchMore(submitted, otherChange)).toBe(false);
    expect(journeyShouldPrefetchMore(submitted, submitted)).toBe(false);
    // Display path may already equal the draft; leftover levels are on the
    // result that produced the rows, not the submitted config.
    expect(journeyShouldPrefetchMore(submitted, oneBefore)).toBe(true);
    expect(journeyShouldPrefetchMore(oneBefore, oneBefore)).toBe(false);
  });

  it("compareConfig treats a serveable path change as a local update", () => {
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
      dataset: journeyDataset({ path: [], depth: 3 }),
    };
    const draft: ExplorationConfig = {
      ...submitted,
      dataset: journeyDataset({
        path: [{ mode: "value", value: "home" }],
        depth: 3,
      }),
    };
    const rows: ProductAnalyticsResultRow[] = [
      {
        dimensions: [],
        journey: {
          kind: "path",
          direction: "forward",
          levels: ["home", "search", "checkout"],
          count: 10,
        },
      },
    ];
    expect(
      compareConfig(submitted, draft, undefined, {
        rowSource: submitted,
        rows,
      }),
    ).toEqual({ needsFetch: false, needsUpdate: true });
    expect(
      compareConfig(submitted, draft, undefined, {
        rowSource: submitted,
        rows: [],
      }),
    ).toEqual({ needsFetch: true, needsUpdate: true });
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
      hasDimension: false,
    });
    expect(model.violations).toEqual([]);
    expect(model.matchedTotal).toBe(100);
    expect(model.anchorTotal).toBe(100);
    const frontier = model.columns.filter((c) => c.frontier);
    expect(frontier).toHaveLength(1);
    expect(frontier[0].nodes.reduce((a, n) => a + n.value, 0)).toBe(100);
  });

  it("splits a client-side commit three ways and matches a fresh query", () => {
    const client = buildJourneyViewModel({
      rows: heldRows,
      dataset: journeyDataset({
        path: [{ mode: "value", value: "home" }],
      }),
      rowPath: [],
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
      rowPath: [{ mode: "value", value: "home" }],
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

  it("keeps submitted steps aligned when committing one more from the same rows", () => {
    const homeRows = heldRows
      .filter(
        (r) => r.journey?.kind === "path" && r.journey.levels[0] === "home",
      )
      .map((r) => {
        if (r.journey?.kind !== "path") return r;
        return {
          ...r,
          journey: { ...r.journey, levels: r.journey.levels.slice(1) },
        };
      });
    const model = buildJourneyViewModel({
      rows: homeRows,
      dataset: journeyDataset({
        path: [
          { mode: "value", value: "home" },
          { mode: "value", value: "search" },
        ],
        depth: 3,
      }),
      rowPath: [{ mode: "value", value: "home" }],
      hasDimension: false,
    });
    expect(model.prefixCount[0]).toBe(50);
    expect(model.prefixCount[1]).toBe(50);
    expect(model.prefixCount[2]).toBe(40);
    const committed = model.columns.filter((c) => c.committed && !c.anchor);
    expect(committed).toHaveLength(2);
    expect(committed[0].nodes[0].value).toBe(50);
    expect(committed[1].nodes[0].value).toBe(40);
    expect(model.columns.filter((c) => c.frontier)).toHaveLength(1);
  });

  it("keeps earlier exits after a filtered prefetch replaces the rows", () => {
    const path = [
      { mode: "value" as const, value: "home" },
      { mode: "value" as const, value: "search" },
    ];
    const observed = buildJourneyViewState({
      rows: heldRows,
      dataset: journeyDataset({ path, depth: 3 }),
      rowPath: [],
      hasDimension: false,
    });
    expect(observed.model.leak[0].exit).toBe(30);
    expect(observed.model.prefixCount[0]).toBe(100);

    const prefetchRows = heldRows
      .filter(
        (r) =>
          r.journey?.kind === "path" &&
          r.journey.levels[0] === "home" &&
          r.journey.levels[1] === "search",
      )
      .map((r) => {
        if (r.journey?.kind !== "path") return r;
        return {
          ...r,
          journey: { ...r.journey, levels: r.journey.levels.slice(2) },
        };
      });
    const afterPrefetch = buildJourneyViewState({
      rows: prefetchRows,
      dataset: journeyDataset({ path, depth: 3 }),
      rowPath: path,
      hasDimension: false,
      previousHistory: observed.history,
    });
    expect(afterPrefetch.model.violations).toEqual([]);
    expect(afterPrefetch.model.prefixCount[0]).toBe(100);
    expect(afterPrefetch.model.prefixCount[1]).toBe(50);
    expect(afterPrefetch.model.leak[0].exit).toBe(30);
    expect(afterPrefetch.model.leak[0].other).toBe(20);
    const committed = afterPrefetch.model.columns.filter(
      (c) => c.committed && !c.anchor,
    );
    expect(committed[0].nodes[0].value).toBe(50);
  });

  it("restores the observed frontier when the path is popped", () => {
    const committed = buildJourneyViewState({
      rows: heldRows,
      dataset: journeyDataset({
        path: [{ mode: "value", value: "home" }],
      }),
      rowPath: [],
      hasDimension: false,
    });
    const filteredToHome = heldRows
      .filter(
        (r) => r.journey?.kind === "path" && r.journey.levels[0] === "home",
      )
      .map((r) => {
        if (r.journey?.kind !== "path") return r;
        return {
          ...r,
          journey: { ...r.journey, levels: r.journey.levels.slice(1) },
        };
      });
    const popped = buildJourneyViewState({
      rows: filteredToHome,
      dataset: journeyDataset({ path: [] }),
      rowPath: [{ mode: "value", value: "home" }],
      hasDimension: false,
      previousHistory: committed.history,
    });
    const frontier = popped.model.columns.find((c) => c.frontier);
    const nodes = Object.fromEntries(
      (frontier?.nodes ?? []).map((n) => [n.key, n.value]),
    );
    expect(nodes.home).toBe(50);
    expect(nodes.search).toBe(20);
    expect(nodes["(exit)"]).toBe(30);
    expect(
      popped.model.columns.filter((c) => c.committed && !c.anchor),
    ).toHaveLength(0);
  });

  it("renders committed drop-off from warehouse rows without interaction history", () => {
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
        path: [
          { mode: "value", value: "home" },
          { mode: "value", value: "search" },
        ],
      }),
      rowPath: [
        { mode: "value", value: "home" },
        { mode: "value", value: "search" },
      ],
      hasDimension: false,
    });
    expect(model.prefixCount[0]).toBe(100);
    expect(model.prefixCount[1]).toBe(50);
    expect(model.leak[0].exit).toBe(30);
    expect(model.leak[0].other).toBe(20);
    expect(model.prefixCount[2]).toBe(40);
  });

  it("does not draw columns past the fetched levels", () => {
    const model = buildJourneyViewModel({
      rows: heldRows,
      dataset: journeyDataset({
        path: [
          { mode: "value", value: "home" },
          { mode: "value", value: "search" },
          { mode: "value", value: "checkout" },
          { mode: "value", value: "thanks" },
        ],
        depth: 3,
      }),
      rowPath: [],
      hasDimension: false,
    });
    const committed = model.columns.filter((c) => c.committed && !c.anchor);
    expect(committed).toHaveLength(3);
    expect(model.columns.filter((c) => c.frontier)).toHaveLength(0);
    expect(committed[0].nodes[0].value).toBe(50);
  });
});
