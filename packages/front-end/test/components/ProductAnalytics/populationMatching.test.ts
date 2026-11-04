import { describe, expect, it } from "vitest";
import type { ApiPopulation, ExplorationPopulation } from "shared/validators";
import type { FactMetricInterface } from "shared/types/fact-table";
import {
  countsEveryPopulationMember,
  findMatchingPopulation,
  toExplorationPopulation,
} from "@/enterprise/components/ProductAnalytics/util";

type PopulationFixture = Pick<
  ApiPopulation,
  "id" | "datasource" | "userIdTypes" | "steps"
>;

const activated: PopulationFixture = {
  id: "pop_activated",
  datasource: "ds_1",
  userIdTypes: ["user_id", "anonymous_id"],
  steps: [
    {
      source: { type: "factTable", factTableId: "ft_events" },
      rowFilters: [
        { operator: "=", column: "event_name", values: ["activated"] },
        { operator: "!=", column: "plan", values: ["internal"] },
      ],
      aggregateFilter: ">=2",
      aggregateFilterColumn: "$$count",
    },
  ],
};

const conditions: ExplorationPopulation = {
  source: { type: "factTable", factTableId: "ft_events" },
  rowFilters: [
    { operator: "!=", column: "plan", values: ["internal"] },
    { values: ["activated"], column: "event_name", operator: "=" },
  ],
  aggregateFilter: ">=2",
  aggregateFilterColumn: "$$count",
  unit: "anonymous_id",
};

describe("findMatchingPopulation", () => {
  it("matches regardless of row filter order or key order", () => {
    expect(findMatchingPopulation(conditions, [activated], "ds_1")).toBe(
      activated,
    );
  });

  it("round-trips a Population through toExplorationPopulation", () => {
    const population = toExplorationPopulation(activated, "user_id");
    if (!population) throw new Error("Expected a population");
    expect(findMatchingPopulation(population, [activated], "ds_1")).toBe(
      activated,
    );
  });

  it("returns null when the Population's conditions changed", () => {
    const edited: PopulationFixture = {
      ...activated,
      steps: [{ ...activated.steps[0], aggregateFilter: ">=3" }],
    };
    expect(findMatchingPopulation(conditions, [edited], "ds_1")).toBeNull();
  });

  it("returns null when a row filter was removed", () => {
    const edited: PopulationFixture = {
      ...activated,
      steps: [
        {
          ...activated.steps[0],
          rowFilters: [activated.steps[0].rowFilters[0]],
        },
      ],
    };
    expect(findMatchingPopulation(conditions, [edited], "ds_1")).toBeNull();
  });

  it("returns null for another datasource or an unsupported unit", () => {
    expect(findMatchingPopulation(conditions, [activated], "ds_2")).toBeNull();
    expect(
      findMatchingPopulation(
        { ...conditions, unit: "account_id" },
        [activated],
        "ds_1",
      ),
    ).toBeNull();
  });

  it("treats a missing aggregate filter the same as an absent one", () => {
    const noAggregate: PopulationFixture = {
      ...activated,
      steps: [
        {
          source: activated.steps[0].source,
          rowFilters: activated.steps[0].rowFilters,
        },
      ],
    };
    expect(
      findMatchingPopulation(
        {
          ...conditions,
          aggregateFilter: undefined,
          aggregateFilterColumn: undefined,
        },
        [noAggregate],
        "ds_1",
      ),
    ).toBe(noAggregate);
  });
});

describe("countsEveryPopulationMember", () => {
  const proportion = (
    numerator: Partial<FactMetricInterface["numerator"]>,
  ): FactMetricInterface =>
    ({
      metricType: "proportion",
      numerator: {
        factTableId: "ft_events",
        column: "$$distinctUsers",
        ...numerator,
      },
    }) as FactMetricInterface;

  it("flags a Proportion metric with no filters", () => {
    expect(
      countsEveryPopulationMember(proportion({ rowFilters: [] }), {
        rowFilters: [],
      }),
    ).toBe(true);
  });

  it("allows a metric with its own row filter, aggregate filter, or a value filter", () => {
    const filter = {
      operator: "=" as const,
      column: "event_name",
      values: ["x"],
    };
    expect(
      countsEveryPopulationMember(proportion({ rowFilters: [filter] }), {
        rowFilters: [],
      }),
    ).toBe(false);
    expect(
      countsEveryPopulationMember(
        proportion({
          rowFilters: [],
          aggregateFilter: ">=2",
          aggregateFilterColumn: "$$count",
        }),
        { rowFilters: [] },
      ),
    ).toBe(false);
    expect(
      countsEveryPopulationMember(proportion({ rowFilters: [] }), {
        rowFilters: [filter],
      }),
    ).toBe(false);
  });

  it("ignores metric types Populations don't support", () => {
    expect(
      countsEveryPopulationMember(
        {
          ...proportion({ rowFilters: [] }),
          metricType: "mean",
        } as FactMetricInterface,
        { rowFilters: [] },
      ),
    ).toBe(false);
  });
});
