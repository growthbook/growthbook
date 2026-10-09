import {
  apiCreatePopulationBody,
  type PopulationStep,
  populationValidator,
} from "shared/validators";
import {
  getPopulationFactTableIds,
  getPopulationRuleViolations,
  MAX_POPULATION_FACT_TABLES,
  MAX_POPULATION_STEPS,
  type PopulationRuleFactTable,
} from "shared/populations";
import type { ColumnInterface } from "shared/types/fact-table";

function column(
  name: string,
  datatype: ColumnInterface["datatype"],
  extra: Partial<ColumnInterface> = {},
): ColumnInterface {
  return {
    dateCreated: new Date(0),
    dateUpdated: new Date(0),
    name,
    description: "",
    column: name,
    datatype,
    numberFormat: "",
    deleted: false,
    ...extra,
  };
}

function step(
  factTableId: string,
  windowType: PopulationStep["windowSettings"]["type"] = "",
): PopulationStep {
  return {
    source: { type: "factTable", factTableId },
    rowFilters: [],
    windowSettings: {
      type: windowType,
      delayValue: 0,
      delayUnit: "days",
      windowValue: 0,
      windowUnit: "days",
    },
  };
}

const events: PopulationRuleFactTable = {
  id: "ftb_events",
  datasource: "ds_main",
  userIdTypes: ["user_id", "anonymous_id"],
  columns: [
    column("amount", "number"),
    column("country", "string"),
    column("props", "json", {
      jsonFields: {
        quantity: { datatype: "number" },
        coupon: { datatype: "string" },
      },
    }),
    column("refund", "number", { deleted: true }),
    column("legacy", "json", {
      deleted: true,
      jsonFields: { quantity: { datatype: "number" } },
    }),
  ],
};
const orders: PopulationRuleFactTable = {
  id: "ftb_orders",
  datasource: "ds_main",
  userIdTypes: ["user_id"],
  columns: [],
};
const otherWarehouse: PopulationRuleFactTable = {
  id: "ftb_other",
  datasource: "ds_other",
  userIdTypes: ["user_id"],
  columns: [],
};

describe("getPopulationFactTableIds", () => {
  it("dedupes fact tables in first-seen order", () => {
    expect(
      getPopulationFactTableIds([
        step("ftb_orders"),
        step("ftb_events"),
        step("ftb_orders"),
      ]),
    ).toEqual(["ftb_orders", "ftb_events"]);
  });
});

describe("getPopulationRuleViolations", () => {
  it("accepts a valid multi-step population", () => {
    expect(
      getPopulationRuleViolations({
        datasource: "ds_main",
        userIdTypes: ["user_id"],
        steps: [
          step("ftb_events", "lookback"),
          step("ftb_orders", "conversion"),
        ],
        factTables: [events, orders],
      }),
    ).toEqual([]);
  });

  it("rejects a conversion window on the first step", () => {
    expect(
      getPopulationRuleViolations({
        datasource: "ds_main",
        userIdTypes: ["user_id"],
        steps: [step("ftb_events", "conversion")],
        factTables: [events],
      }),
    ).toEqual(["The first step cannot use a conversion window."]);
  });

  it("reports a fact table that was not found", () => {
    expect(
      getPopulationRuleViolations({
        datasource: "ds_main",
        userIdTypes: ["user_id"],
        steps: [step("ftb_missing")],
        factTables: [],
      }),
    ).toEqual(["Fact table ftb_missing not found."]);
  });

  it("reports a fact table from a different Data Source", () => {
    expect(
      getPopulationRuleViolations({
        datasource: "ds_main",
        userIdTypes: ["user_id"],
        steps: [step("ftb_other")],
        factTables: [otherWarehouse],
      }),
    ).toEqual(["Fact table ftb_other is not in Data Source ds_main."]);
  });

  it("lists every identifier type a fact table is missing", () => {
    expect(
      getPopulationRuleViolations({
        datasource: "ds_main",
        userIdTypes: ["user_id", "anonymous_id", "device_id"],
        steps: [step("ftb_orders")],
        factTables: [orders],
      }),
    ).toEqual([
      "Fact table ftb_orders does not support identifier types: anonymous_id, device_id.",
    ]);
  });

  it("reports a fact table used by several steps only once", () => {
    expect(
      getPopulationRuleViolations({
        datasource: "ds_main",
        userIdTypes: ["user_id"],
        steps: [step("ftb_missing"), step("ftb_missing")],
        factTables: [],
      }),
    ).toEqual(["Fact table ftb_missing not found."]);
  });

  it("allows the maximum number of steps", () => {
    expect(
      getPopulationRuleViolations({
        datasource: "ds_main",
        userIdTypes: ["user_id"],
        steps: Array.from({ length: MAX_POPULATION_STEPS }, () =>
          step("ftb_events"),
        ),
        factTables: [events],
      }),
    ).toEqual([]);
  });

  it("rejects more than the maximum number of steps", () => {
    expect(
      getPopulationRuleViolations({
        datasource: "ds_main",
        userIdTypes: ["user_id"],
        steps: Array.from({ length: MAX_POPULATION_STEPS + 1 }, () =>
          step("ftb_events"),
        ),
        factTables: [events],
      }),
    ).toEqual([
      `Populations can have at most ${MAX_POPULATION_STEPS} steps (this one has ${MAX_POPULATION_STEPS + 1}).`,
    ]);
  });

  it("limits the number of distinct fact tables, not steps per fact table", () => {
    const tables = Array.from(
      { length: MAX_POPULATION_FACT_TABLES + 1 },
      (_, i): PopulationRuleFactTable => ({
        id: `ftb_${i}`,
        datasource: "ds_main",
        userIdTypes: ["user_id"],
        columns: [],
      }),
    );
    const atCap = tables.slice(0, MAX_POPULATION_FACT_TABLES);

    expect(
      getPopulationRuleViolations({
        datasource: "ds_main",
        userIdTypes: ["user_id"],
        steps: [...atCap, ...atCap].map((t) => step(t.id)),
        factTables: atCap,
      }),
    ).toEqual([]);
    expect(
      getPopulationRuleViolations({
        datasource: "ds_main",
        userIdTypes: ["user_id"],
        steps: tables.map((t) => step(t.id)),
        factTables: tables,
      }),
    ).toEqual([
      `Populations can read from at most ${MAX_POPULATION_FACT_TABLES} distinct fact tables (this one reads from ${MAX_POPULATION_FACT_TABLES + 1}).`,
    ]);
  });

  it("requires aggregateFilter and aggregateFilterColumn together", () => {
    const run = (steps: PopulationStep[]) =>
      getPopulationRuleViolations({
        datasource: "ds_main",
        userIdTypes: ["user_id"],
        steps,
        factTables: [events],
      });

    expect(
      run([
        step("ftb_events"),
        {
          ...step("ftb_events"),
          aggregateFilter: ">=3",
          aggregateFilterColumn: "$$count",
        },
      ]),
    ).toEqual([]);
    expect(
      run([
        { ...step("ftb_events"), aggregateFilter: ">=3" },
        step("ftb_events"),
        { ...step("ftb_events"), aggregateFilterColumn: "amount" },
      ]),
    ).toEqual([
      'Must specify both "aggregateFilter" and "aggregateFilterColumn" or neither (step 1, 3).',
    ]);
  });

  describe("aggregate filter column and syntax", () => {
    const withAggregate = (
      aggregateFilterColumn: string,
      aggregateFilter = ">=3",
      factTableId = "ftb_events",
    ): PopulationStep => ({
      ...step(factTableId),
      aggregateFilter,
      aggregateFilterColumn,
    });
    const run = (...steps: PopulationStep[]) =>
      getPopulationRuleViolations({
        datasource: "ds_main",
        userIdTypes: ["user_id"],
        steps,
        factTables: [events, orders],
      });

    it("accepts numeric columns, numeric JSON fields, and $$count", () => {
      expect(
        run(
          withAggregate("amount"),
          withAggregate("props.quantity", ">=1,<10"),
          withAggregate("$$count", "> 2"),
        ),
      ).toEqual([]);
    });

    it("rejects non-numeric and unknown columns", () => {
      expect(
        run(
          withAggregate("country"),
          withAggregate("props.coupon"),
          withAggregate("missing"),
        ),
      ).toEqual([
        `Aggregate filter column 'country' must be a numeric column or "$$count" (step 1).`,
        `Aggregate filter column 'props.coupon' must be a numeric column or "$$count" (step 2).`,
        `Aggregate filter column 'missing' must be a numeric column or "$$count" (step 3).`,
      ]);
    });

    it("rejects deleted numeric columns and fields of deleted JSON columns", () => {
      expect(
        run(withAggregate("refund"), withAggregate("legacy.quantity")),
      ).toEqual([
        `Aggregate filter column 'refund' must be a numeric column or "$$count" (step 1).`,
        `Aggregate filter column 'legacy.quantity' must be a numeric column or "$$count" (step 2).`,
      ]);
    });

    it("rejects filters that are not comma-separated comparisons", () => {
      expect(
        run(
          withAggregate("$$count", "lots"),
          withAggregate("$$count", ">=3,<"),
          withAggregate("$$count", ","),
        ),
      ).toEqual([
        'Invalid aggregate filter "lots" (step 1). Use comparisons such as ">=3" or ">=3,<10".',
        'Invalid aggregate filter ">=3,<" (step 2). Use comparisons such as ">=3" or ">=3,<10".',
        'Invalid aggregate filter "," (step 3). Use comparisons such as ">=3" or ">=3,<10".',
      ]);
    });

    it("leaves a missing fact table to the existence check", () => {
      expect(
        getPopulationRuleViolations({
          datasource: "ds_main",
          userIdTypes: ["user_id"],
          steps: [withAggregate("amount", ">=3", "ftb_missing")],
          factTables: [],
        }),
      ).toEqual(["Fact table ftb_missing not found."]);
    });
  });

  it("returns every violation together", () => {
    expect(
      getPopulationRuleViolations({
        datasource: "ds_main",
        userIdTypes: ["anonymous_id"],
        steps: [
          step("ftb_events", "conversion"),
          step("ftb_orders"),
          step("ftb_other"),
        ],
        factTables: [events, orders, otherWarehouse],
      }),
    ).toEqual([
      "The first step cannot use a conversion window.",
      "Fact table ftb_orders does not support identifier types: anonymous_id.",
      "Fact table ftb_other is not in Data Source ds_main.",
    ]);
  });
});

describe("population step limits in validators", () => {
  const steps = (count: number) =>
    Array.from({ length: count }, () => step("ftb_events"));
  const createBody = (count: number) => ({
    name: "Purchasers",
    owner: "u_1",
    datasource: "ds_main",
    userIdTypes: ["user_id"],
    steps: steps(count),
  });

  it("caps steps on the API create body", () => {
    expect(
      apiCreatePopulationBody.safeParse(createBody(MAX_POPULATION_STEPS))
        .success,
    ).toBe(true);
    expect(
      apiCreatePopulationBody.safeParse(createBody(MAX_POPULATION_STEPS + 1))
        .success,
    ).toBe(false);
  });

  it("caps steps on the stored document", () => {
    const stepsField = populationValidator.shape.steps;
    expect(stepsField.safeParse(steps(MAX_POPULATION_STEPS)).success).toBe(
      true,
    );
    expect(stepsField.safeParse(steps(MAX_POPULATION_STEPS + 1)).success).toBe(
      false,
    );
  });
});
