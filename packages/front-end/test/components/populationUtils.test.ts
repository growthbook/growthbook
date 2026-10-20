import type { PopulationStep } from "shared/validators";
import type {
  ColumnInterface,
  FactTableDefinition,
  RowFilter,
} from "shared/types/fact-table";
import { describePopulationStep } from "@/components/Populations/populationUtils";

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
    windowSettings: {
      type: "",
      delayValue: 0,
      delayUnit: "days",
      windowValue: 0,
      windowUnit: "days",
    },
  };
}

describe("describePopulationStep", () => {
  const eventsTable: FactTableDefinition = {
    organization: "org_1",
    id: "ftb_events",
    dateCreated: new Date(0),
    dateUpdated: new Date(0),
    name: "Events",
    description: "",
    owner: "",
    projects: [],
    tags: [],
    datasource: "ds_main",
    userIdTypes: ["user_id"],
    eventName: "",
    columns: [column("amount", "number"), column("country", "string")],
    filters: [
      {
        id: "flt_purchases",
        dateCreated: new Date(0),
        dateUpdated: new Date(0),
        name: "Purchases only",
        description: "",
        value: "event_name = 'purchase'",
      },
    ],
  };
  const country: RowFilter = {
    column: "country",
    operator: "=",
    values: ["US"],
  };
  const amount: RowFilter = {
    column: "amount",
    operator: ">",
    values: ["100"],
  };
  const lastWeek: PopulationStep["windowSettings"] = {
    ...step("ftb_events").windowSettings,
    type: "lookback",
    windowValue: 1,
    windowUnit: "weeks",
  };

  const getStepDescription = (
    overrides: Partial<PopulationStep>,
    factTable: FactTableDefinition | null = eventsTable,
  ) => {
    const { beforeFactTableName, factTableName, afterFactTableName } =
      describePopulationStep({
        step: { ...step("ftb_events"), ...overrides },
        identifierTypes: ["user_id"],
        factTable,
      });
    return `${beforeFactTableName}${factTableName}${afterFactTableName}`;
  };

  it("splits the sentence around the fact table name", () => {
    expect(
      describePopulationStep({
        step: { ...step("ftb_has"), rowFilters: [country] },
        identifierTypes: ["user_id"],
        factTable: { ...eventsTable, name: "Has" },
      }),
    ).toEqual({
      beforeFactTableName: "Has ",
      factTableName: "Has",
      afterFactTableName: " matching the row filter: country=US",
    });
  });

  it("describes a step with no filters or windows", () => {
    expect(getStepDescription({})).toBe("Has Events");
  });

  it("describes a step with one row filter", () => {
    expect(getStepDescription({ rowFilters: [country] })).toBe(
      "Has Events matching the row filter: country=US",
    );
  });

  it("describes a step with multiple row filters", () => {
    expect(getStepDescription({ rowFilters: [country, amount] })).toBe(
      "Has Events matching the row filters: country=US, amount>100",
    );
  });

  it("describes a step with row filters and an aggregate filter", () => {
    expect(
      getStepDescription({
        rowFilters: [country],
        aggregateFilterColumn: "$$count",
        aggregateFilter: ">=3",
      }),
    ).toBe(
      "Has Events matching the row filter: country=US and aggregate filter: count >=3 per user_id",
    );
  });

  it("describes a step with row filters and an aggregate filter with multiple conditions", () => {
    expect(
      getStepDescription({
        rowFilters: [country],
        aggregateFilterColumn: "$$count",
        aggregateFilter: ">=3,<=10",
      }),
    ).toBe(
      "Has Events matching the row filter: country=US and aggregate filter: count >=3,<=10 per user_id",
    );
  });

  it("describes a step with an aggregate filter and no row filters", () => {
    expect(
      getStepDescription({
        aggregateFilterColumn: "amount",
        aggregateFilter: ">100",
      }),
    ).toBe(
      "Has Events matching the aggregate filter: total amount >100 per user_id",
    );
  });

  it("describes a step with a lookback window", () => {
    expect(getStepDescription({ windowSettings: lastWeek })).toBe(
      "Has Events in the last 1 week",
    );
  });

  it("describes a step with row filters, an aggregate filter, and a lookback window", () => {
    expect(
      getStepDescription({
        rowFilters: [country],
        aggregateFilterColumn: "$$count",
        aggregateFilter: ">=3",
        windowSettings: lastWeek,
      }),
    ).toBe(
      "Has Events matching the row filter: country=US and aggregate filter: count >=3 per user_id in the last 1 week",
    );
  });

  it("uses readable labels for other row filter operators", () => {
    const getFilterDescription = (rowFilter: RowFilter) =>
      getStepDescription({ rowFilters: [rowFilter] }).replace(
        "Has Events matching the row filter: ",
        "",
      );
    expect(
      getFilterDescription({
        column: "country",
        operator: "not_in",
        values: ["US", "CA"],
      }),
    ).toBe("country not in US, CA");
    expect(
      getFilterDescription({ column: "country", operator: "is_null" }),
    ).toBe("country is null");
    expect(
      getFilterDescription({ operator: "sql_expr", values: ["amount > 0"] }),
    ).toBe("SQL expr");
  });

  describe("saved filters", () => {
    const savedFilter = (id: string): RowFilter => ({
      operator: "saved_filter",
      values: [id],
    });

    it("uses the saved filter's name", () => {
      expect(
        getStepDescription({ rowFilters: [savedFilter("flt_purchases")] }),
      ).toBe("Has Events matching the row filter: Purchases only");
    });

    it("uses a generic label when the saved filter was deleted", () => {
      expect(
        getStepDescription({ rowFilters: [savedFilter("flt_gone")] }),
      ).toBe("Has Events matching the row filter: Saved Filter");
    });

    it("uses a generic label when the fact table is missing", () => {
      expect(
        getStepDescription(
          { rowFilters: [savedFilter("flt_purchases")] },
          null,
        ),
      ).toBe("Has ftb_events matching the row filter: Saved Filter");
    });
  });

  it("uses column display names", () => {
    expect(
      getStepDescription(
        { rowFilters: [country] },
        {
          ...eventsTable,
          columns: [column("country", "string", { name: "Country" })],
        },
      ),
    ).toBe("Has Events matching the row filter: Country=US");
  });

  it("falls back to ids when the fact table is missing", () => {
    expect(
      getStepDescription(
        {
          rowFilters: [country],
          aggregateFilterColumn: "amount",
          aggregateFilter: ">100",
        },
        null,
      ),
    ).toBe(
      "Has ftb_events matching the row filter: country=US and aggregate filter: total amount >100 per user_id",
    );
  });
});
