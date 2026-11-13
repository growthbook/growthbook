import {
  apiCreatePopulationBody,
  apiUpdatePopulationBody,
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

function step(factTableId: string): PopulationStep {
  return {
    source: { type: "factTable", factTableId },
    rowFilters: [],
  };
}

const events: PopulationRuleFactTable = {
  id: "ftb_events",
  datasource: "ds_main",
  userIdTypes: ["user_id", "anonymous_id"],
  filters: [{ id: "flt_mobile", name: "Mobile", value: "device = 'mobile'" }],
  columns: [
    column("amount", "number"),
    column("country", "string"),
    column("signup_date", "date"),
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
  filters: [],
};
const otherWarehouse: PopulationRuleFactTable = {
  id: "ftb_other",
  datasource: "ds_other",
  userIdTypes: ["user_id"],
  columns: [],
  filters: [],
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
        steps: [step("ftb_events"), step("ftb_orders")],
        factTables: [events, orders],
      }),
    ).toEqual([]);
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

  it("reports a saved filter the fact table doesn't have", () => {
    const savedFilter = (id: string): PopulationStep => ({
      ...step("ftb_events"),
      rowFilters: [{ operator: "saved_filter", values: [id] }],
    });
    const check = (id: string) =>
      getPopulationRuleViolations({
        datasource: "ds_main",
        userIdTypes: ["user_id"],
        steps: [savedFilter(id)],
        factTables: [events],
      });
    expect(check("flt_mobile")).toEqual([]);
    expect(check("flt_deleted")).toEqual([
      "Row filter 1 uses saved filter flt_deleted, which isn't on Fact Table ftb_events.",
    ]);
  });

  it("reports row filters that would add no SQL", () => {
    const check = (rowFilters: PopulationStep["rowFilters"]) =>
      getPopulationRuleViolations({
        datasource: "ds_main",
        userIdTypes: ["user_id"],
        steps: [{ ...step("ftb_events"), rowFilters }],
        factTables: [events],
      });
    expect(
      check([
        { operator: "=", column: "country", values: ["US"] },
        { operator: "=", values: ["US"] },
        { operator: "sql_expr", values: ["  "] },
        { operator: "in", column: "country", values: [] },
        { operator: "is_null", column: "country" },
      ]),
    ).toEqual([
      "Row filter 2 needs a column.",
      "Row filter 3 has no SQL expression.",
      "Row filter 4 needs a value.",
    ]);
  });

  it("reports a date filter whose values are all blank", () => {
    expect(
      getPopulationRuleViolations({
        datasource: "ds_main",
        userIdTypes: ["user_id"],
        steps: [
          {
            ...step("ftb_events"),
            rowFilters: [
              { operator: "=", column: "signup_date", values: [" "] },
              { operator: ">=", column: "signup_date", values: ["2026-01-01"] },
            ],
          },
        ],
        factTables: [events],
      }),
    ).toEqual(["Row filter 1 needs a value."]);
  });

  it("reports a range whose two bounds are blank on any column", () => {
    expect(
      getPopulationRuleViolations({
        datasource: "ds_main",
        userIdTypes: ["user_id"],
        steps: [
          {
            ...step("ftb_events"),
            rowFilters: [
              { operator: "between", column: "country", values: [" ", ""] },
              { operator: "not_between", column: "country", values: [" "] },
              { operator: "between", column: "country", values: ["", "", "5"] },
              { operator: "between", column: "country", values: ["", "M"] },
            ],
          },
        ],
        factTables: [events],
      }),
    ).toEqual([
      "Row filter 1 needs a value.",
      "Row filter 2 needs a value.",
      "Row filter 3 needs a value.",
    ]);
  });

  it("reports the filters the editor leaves untouched", () => {
    expect(
      getPopulationRuleViolations({
        datasource: "ds_main",
        userIdTypes: ["user_id"],
        steps: [
          {
            ...step("ftb_events"),
            rowFilters: [
              { operator: "=", column: "country", values: [""] },
              { operator: "saved_filter", values: [""] },
              { operator: "=", column: "country", values: [" "] },
            ],
          },
        ],
        factTables: [events],
      }),
    ).toEqual([
      "Row filter 1 needs a value.",
      "Row filter 2 has no saved filter.",
    ]);
  });

  it("reports filters missing the parts getRowFilterSQL reads", () => {
    expect(
      getPopulationRuleViolations({
        datasource: "ds_main",
        userIdTypes: ["user_id"],
        steps: [
          {
            ...step("ftb_events"),
            rowFilters: [
              { operator: "is_null" },
              { operator: "sql_expr", values: [] },
              { operator: "sql_expr", values: ["", "a = 1"] },
              { operator: "saved_filter", values: ["  "] },
              { operator: "saved_filter", values: ["", "flt_mobile"] },
            ],
          },
        ],
        factTables: [events],
      }),
    ).toEqual([
      "Row filter 1 needs a column.",
      "Row filter 2 has no SQL expression.",
      "Row filter 3 has no SQL expression.",
      "Row filter 4 has no saved filter.",
      "Row filter 5 has no saved filter.",
    ]);
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

  it("limits the number of distinct fact tables, not steps per fact table", () => {
    const tables = Array.from(
      { length: MAX_POPULATION_FACT_TABLES + 1 },
      (_, i): PopulationRuleFactTable => ({
        id: `ftb_${i}`,
        datasource: "ds_main",
        userIdTypes: ["user_id"],
        columns: [],
        filters: [],
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

    it("rejects JSON sub-fields when the fact table has no jsonFields", () => {
      const slimEvents: PopulationRuleFactTable = {
        ...events,
        columns: events.columns.map((c) => ({ ...c, jsonFields: undefined })),
      };
      expect(
        getPopulationRuleViolations({
          datasource: "ds_main",
          userIdTypes: ["user_id"],
          steps: [withAggregate("props.quantity")],
          factTables: [slimEvents],
        }),
      ).toEqual([
        `Aggregate filter column 'props.quantity' must be a numeric column or "$$count".`,
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
        steps: [step("ftb_events"), step("ftb_orders"), step("ftb_other")],
        factTables: [events, orders, otherWarehouse],
      }),
    ).toEqual([
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

  it("trims the name and rejects one that is only spaces", () => {
    const parsed = apiCreatePopulationBody.parse({
      ...createBody(1),
      name: "  Purchasers  ",
    });
    expect(parsed.name).toBe("Purchasers");
    expect(
      apiCreatePopulationBody.safeParse({ ...createBody(1), name: "   " })
        .success,
    ).toBe(false);
    expect(apiUpdatePopulationBody.safeParse({ name: "   " }).success).toBe(
      false,
    );
    expect(apiUpdatePopulationBody.safeParse({}).success).toBe(true);
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
