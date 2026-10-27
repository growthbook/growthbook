import {
  apiCreatePopulationBody,
  type PopulationStep,
  populationValidator,
} from "shared/validators";
import {
  getPopulationFactTableIds,
  getPopulationRuleViolations,
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
  it("accepts a valid single-step population", () => {
    expect(
      getPopulationRuleViolations({
        datasource: "ds_main",
        userIdTypes: ["user_id"],
        steps: [step("ftb_events")],
        factTables: [events],
      }),
    ).toEqual([]);
  });

  it("rejects a population that reads from more than one fact table", () => {
    expect(
      getPopulationRuleViolations({
        datasource: "ds_main",
        userIdTypes: ["user_id"],
        steps: [step("ftb_events"), step("ftb_orders")],
        factTables: [events, orders],
      }),
    ).toEqual([
      "Populations can read from at most 1 distinct fact table (this one reads from 2).",
    ]);
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

  it.each([{ aggregateFilter: ">=3" }, { aggregateFilterColumn: "amount" }])(
    "rejects an incomplete aggregate filter: %j",
    (aggregate) => {
      expect(
        getPopulationRuleViolations({
          datasource: "ds_main",
          userIdTypes: ["user_id"],
          steps: [{ ...step("ftb_events"), ...aggregate }],
          factTables: [events],
        }),
      ).toEqual([
        'Must specify both "aggregateFilter" and "aggregateFilterColumn" or neither (step 1).',
      ]);
    },
  );

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
    const run = (populationStep: PopulationStep) =>
      getPopulationRuleViolations({
        datasource: "ds_main",
        userIdTypes: ["user_id"],
        steps: [populationStep],
        factTables: [events],
      });

    it.each([
      ["amount", ">=3"],
      ["props.quantity", ">=1,<10"],
      ["$$count", "> 2"],
    ])("accepts aggregate column %s with filter %s", (column, filter) => {
      expect(run(withAggregate(column, filter))).toEqual([]);
    });

    it.each(["country", "props.coupon", "missing"])(
      "rejects non-numeric or unknown aggregate column %s",
      (column) => {
        expect(run(withAggregate(column))).toEqual([
          `Aggregate filter column '${column}' must be a numeric column or "$$count" (step 1).`,
        ]);
      },
    );

    it.each(["refund", "legacy.quantity"])(
      "rejects deleted aggregate column %s",
      (column) => {
        expect(run(withAggregate(column))).toEqual([
          `Aggregate filter column '${column}' must be a numeric column or "$$count" (step 1).`,
        ]);
      },
    );

    it.each(["lots", ">=3,<", ","])(
      "rejects invalid aggregate filter %s",
      (filter) => {
        expect(run(withAggregate("$$count", filter))).toEqual([
          `Invalid aggregate filter "${filter}" (step 1). Use comparisons such as ">=3" or ">=3,<10".`,
        ]);
      },
    );

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
        `Aggregate filter column 'props.quantity' must be a numeric column or "$$count" (step 1).`,
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

  it("returns all violations for a single step", () => {
    expect(
      getPopulationRuleViolations({
        datasource: "ds_main",
        userIdTypes: ["anonymous_id"],
        steps: [
          {
            ...step("ftb_orders"),
            aggregateFilter: "lots",
            aggregateFilterColumn: "missing",
          },
        ],
        factTables: [orders],
      }),
    ).toEqual([
      "Fact table ftb_orders does not support identifier types: anonymous_id.",
      'Invalid aggregate filter "lots" (step 1). Use comparisons such as ">=3" or ">=3,<10".',
      `Aggregate filter column 'missing' must be a numeric column or "$$count" (step 1).`,
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
