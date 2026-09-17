import { describe, expect, it } from "vitest";
import {
  journeyExplorationConfigValidator,
  funnelExplorationConfigValidator,
} from "shared/validators";
import {
  EXPLORER_AUTO_RUN_QUERY,
  funnelExploreHref,
  journeyToFunnel,
  journeyFunnelLink,
  selectedJourneySteps,
} from "@/enterprise/components/ProductAnalytics/journeyFunnel";

const config = journeyExplorationConfigValidator.parse({
  type: "journey",
  chartType: "bar",
  datasource: "ds",
  dateRange: {
    predefined: "last7Days",
    startDate: null,
    endDate: null,
    lookbackValue: null,
    lookbackUnit: null,
  },
  dimensions: [{ dimensionType: "dynamic", column: "country", maxValues: 3 }],
  dataset: {
    type: "journey",
    factTableId: "events",
    unit: "user_id",
    stepColumns: ["url"],
    anchorStepValues: ["/items/*"],
    direction: "forward",
    path: [{ value: "/checkout" }],
    rowFilters: [{ column: "country", operator: "=", values: ["US"] }],
    stepGroups: [{ column: "url", pattern: "/items/*" }],
    lookaheadDepth: 2,
    optionsPerStep: [],
  },
});

describe("journeyToFunnel", () => {
  it("copies configuration and applies global filters to every step", () => {
    const funnel = funnelExplorationConfigValidator.parse(
      journeyToFunnel(config),
    );
    expect(funnel.datasource).toBe(config.datasource);
    expect(funnel.dateRange).toEqual(config.dateRange);
    expect(funnel.dimensions).toEqual(config.dimensions);
    expect(funnel.dataset.unit).toBe("user_id");
    for (const step of funnel.dataset.steps) {
      expect(step.factTableId).toBe("events");
      expect(step.rowFilters[0]).toEqual(config.dataset.rowFilters[0]);
    }
    expect(funnel.dataset.steps[0].rowFilters[1]).toEqual({
      column: "url",
      operator: "matches_pattern",
      values: ["/items/*"],
    });
    expect(funnel.dataset.steps[1].rowFilters[1]).toEqual({
      column: "url",
      operator: "=",
      values: ["/checkout"],
    });
  });
  it("reverses backward badges and funnel steps but retains removal indices", () => {
    const backward = {
      ...config,
      dataset: { ...config.dataset, direction: "backward" as const },
    };
    expect(selectedJourneySteps(backward.dataset)).toEqual([
      { label: "/checkout", index: 1 },
      { label: "/items/*", index: 0 },
    ]);
    const funnel = funnelExplorationConfigValidator.parse(
      journeyToFunnel(backward),
    );
    expect(funnel.dataset.steps.map((step) => step.name)).toEqual([
      "/checkout",
      "/items/*",
    ]);
  });
  it("builds a funnel explorer URL that auto-runs on load", () => {
    const href = funnelExploreHref(journeyToFunnel(config));
    const url = new URL(href, "https://app.growthbook.io");
    expect(url.pathname).toBe("/product-analytics/explore/funnel");
    expect(url.searchParams.get(EXPLORER_AUTO_RUN_QUERY)).toBe("1");
    expect(url.searchParams.get("config")).toBeTruthy();
  });
  it("preserves multi-column values and complex grouping precedence", () => {
    const multi = {
      ...config,
      dataset: {
        ...config.dataset,
        stepColumns: ["event", "url"],
        anchorStepValues: ["view", "/items/*"],
        path: [{ value: "click / /items/?/details*" }],
        stepGroups: [
          { column: "url", pattern: "/items/private*" },
          { column: "url", pattern: "/items/*" },
          { column: "url", pattern: "/items/?/details*" },
        ],
      },
    };
    const funnel = funnelExplorationConfigValidator.parse(
      journeyToFunnel(multi),
    );
    expect(funnel.dataset.steps[0].rowFilters.slice(1)).toEqual([
      { column: "event", operator: "=", values: ["view"] },
      { column: "url", operator: "matches_pattern", values: ["/items/*"] },
      {
        column: "url",
        operator: "not_matches_pattern",
        values: ["/items/private*"],
      },
    ]);
    expect(funnel.dataset.steps[1].rowFilters).toContainEqual({
      column: "url",
      operator: "matches_pattern",
      values: ["/items/?/details*"],
    });
  });
  it("keeps ungrouped wildcard characters literal", () => {
    const funnel = funnelExplorationConfigValidator.parse(
      journeyToFunnel({
        ...config,
        dataset: { ...config.dataset, stepGroups: [] },
      }),
    );
    expect(funnel.dataset.steps[0].rowFilters[1]).toEqual({
      column: "url",
      operator: "=",
      values: ["/items/*"],
    });
  });
  it("does not guess when combined step labels cannot be split unambiguously", () => {
    expect(() =>
      journeyToFunnel({
        ...config,
        dataset: {
          ...config.dataset,
          stepColumns: ["event", "url"],
          anchorStepValues: ["view", "/items/*"],
          path: [{ value: "click / /items / details" }],
        },
      }),
    ).toThrow(/ambiguous/);
  });
  it("requires at least two selected events", () => {
    expect(() =>
      journeyToFunnel({ ...config, dataset: { ...config.dataset, path: [] } }),
    ).toThrow(/two/);
  });
});

describe("selectedJourneySteps after clearing the anchor", () => {
  it.each(["forward", "backward"] as const)(
    "does not render empty badges for %s journeys",
    (direction) => {
      expect(
        selectedJourneySteps({
          ...config.dataset,
          direction,
          anchorStepValues: null,
          path: [],
        }),
      ).toEqual([]);
      expect(
        selectedJourneySteps({
          ...config.dataset,
          direction,
          anchorStepValues: [""],
          path: [],
        }),
      ).toEqual([]);
    },
  );
});

describe("journeyFunnelLink", () => {
  it("returns an auto-run link for a convertible path", () => {
    const link = journeyFunnelLink(config);
    expect(link.error).toBeNull();
    expect(link.href).toBe(funnelExploreHref(journeyToFunnel(config)));
  });

  it("returns an explanation instead of throwing for an ambiguous path", () => {
    const link = journeyFunnelLink({
      ...config,
      dataset: {
        ...config.dataset,
        stepColumns: ["event", "url"],
        anchorStepValues: ["view", "/items/*"],
        path: [{ value: "click / /items / details" }],
      },
    });
    expect(link.href).toBeNull();
    expect(link.error).toMatch(/ambiguous/);
  });
});
