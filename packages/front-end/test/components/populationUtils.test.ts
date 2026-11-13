import type { PopulationStep } from "shared/validators";
import type {
  ColumnInterface,
  FactTableDefinition,
  RowFilter,
} from "shared/types/fact-table";
import {
  describePopulationStep,
  getPopulationMemberCounts,
  getPopulationPreviewConfig,
  type PopulationFormValues,
  toFormValues,
  toStep,
} from "@/components/Populations/populationUtils";

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

  const getStepDescription = (
    overrides: Partial<PopulationStep>,
    factTable: FactTableDefinition | null = eventsTable,
  ) => {
    return describePopulationStep({
      step: { ...step("ftb_events"), ...overrides },
      identifierTypes: ["user_id"],
      factTable,
    })
      .map((segment) => (typeof segment === "string" ? segment : segment.label))
      .join("");
  };

  it("links the fact table name", () => {
    expect(
      describePopulationStep({
        step: { ...step("ftb_has"), rowFilters: [country] },
        identifierTypes: ["user_id"],
        factTable: { ...eventsTable, name: "Has" },
      }),
    ).toEqual([
      "Has ",
      { label: "Has", href: "/fact-tables/ftb_has" },
      " matching country = US",
    ]);
  });

  it("omits the trailing segment when there are no filters", () => {
    expect(
      describePopulationStep({
        step: step("ftb_events"),
        identifierTypes: ["user_id"],
        factTable: eventsTable,
      }),
    ).toEqual(["Has ", { label: "Events", href: "/fact-tables/ftb_events" }]);
  });

  it("shows the fact table id as plain text when the fact table is missing", () => {
    expect(
      describePopulationStep({
        step: step("ftb_events"),
        identifierTypes: ["user_id"],
        factTable: null,
      }),
    ).toEqual(["Has ", "ftb_events"]);
  });

  it("describes a step with no filters", () => {
    expect(getStepDescription({})).toBe("Has Events");
  });

  it("describes a step with one row filter", () => {
    expect(getStepDescription({ rowFilters: [country] })).toBe(
      "Has Events matching country = US",
    );
  });

  it("describes a step with multiple row filters", () => {
    expect(getStepDescription({ rowFilters: [country, amount] })).toBe(
      "Has Events matching country = US, amount > 100",
    );
  });

  it("describes a step with row filters and an aggregate filter", () => {
    expect(
      getStepDescription({
        rowFilters: [country],
        aggregateFilterColumn: "$$count",
        aggregateFilter: ">=3",
      }),
    ).toBe("Has Events matching country = US and count >=3 per user_id");
  });

  it("describes a step with row filters and an aggregate filter with multiple conditions", () => {
    expect(
      getStepDescription({
        rowFilters: [country],
        aggregateFilterColumn: "$$count",
        aggregateFilter: ">=3,<=10",
      }),
    ).toBe("Has Events matching country = US and count >=3,<=10 per user_id");
  });

  it("describes a step with an aggregate filter and no row filters", () => {
    expect(
      getStepDescription({
        aggregateFilterColumn: "amount",
        aggregateFilter: ">100",
      }),
    ).toBe("Has Events matching total amount >100 per user_id");
  });

  it("uses saved filter names", () => {
    expect(
      getStepDescription({
        rowFilters: [{ operator: "saved_filter", values: ["flt_purchases"] }],
      }),
    ).toBe("Has Events matching Purchases only");
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
    ).toBe("Has Events matching Country = US");
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
      "Has ftb_events matching country = US and total amount >100 per user_id",
    );
  });
});

describe("getPopulationPreviewConfig", () => {
  it("carries each step's filters and the chosen unit into the query", () => {
    const region: RowFilter = {
      column: "region",
      operator: "=",
      values: ["EU"],
    };
    const dateRange = {
      predefined: "customDateRange" as const,
      startDate: "2026-10-23",
      endDate: "2026-10-29",
    };
    const config = getPopulationPreviewConfig(
      {
        datasource: "ds_main",
        steps: [
          {
            ...step("ftb_events"),
            rowFilters: [region],
            aggregateFilter: ">=3",
            aggregateFilterColumn: "$$count",
          },
        ],
      },
      "anonymous_id",
      dateRange,
    );

    expect(config.datasource).toBe("ds_main");
    expect(config.dateRange).toBe(dateRange);
    expect(config.dimensions).toEqual([
      { dimensionType: "date", column: "date", dateGranularity: "day" },
    ]);
    expect(config.dataset.values).toEqual([
      {
        type: "population",
        name: "Members",
        unit: "anonymous_id",
        source: { type: "factTable", factTableId: "ftb_events" },
        rowFilters: [region],
        aggregateFilter: ">=3",
        aggregateFilterColumn: "$$count",
      },
    ]);
  });
});

describe("getPopulationMemberCounts", () => {
  it("orders daily counts, fills empty days, and totals the full range", () => {
    expect(
      getPopulationMemberCounts({
        dateStart: "2026-09-01T00:00:00Z",
        dateEnd: "2026-09-03T12:00:00Z",
        result: {
          rows: [
            {
              dimensions: ["2026-09-03"],
              values: [{ metricId: "count", numerator: 12, denominator: null }],
            },
            {
              dimensions: ["2026-09-01"],
              values: [{ metricId: "count", numerator: 8, denominator: null }],
            },
          ],
        },
      }),
    ).toEqual({
      dailyValues: [
        { day: "2026-09-01", value: 8 },
        { day: "2026-09-02", value: 0 },
        { day: "2026-09-03", value: 12 },
      ],
      total: 20,
    });
  });
});

describe("toStep", () => {
  const values: PopulationFormValues = {
    name: "Buyers",
    description: "",
    datasource: "ds_1",
    userIdTypes: ["user_id"],
    factTableId: "ftb_events",
    rowFilters: [{ operator: "=", column: "country", values: ["US"] }],
    aggregateFilterColumn: "",
    aggregateFilter: "",
  };

  it("leaves out the threshold when there is no comparison", () => {
    expect(toStep({ ...values, aggregateFilter: "   " })).toEqual({
      source: { type: "factTable", factTableId: "ftb_events" },
      rowFilters: values.rowFilters,
    });
  });

  it("trims the comparison and counts rows when no column is chosen", () => {
    expect(toStep({ ...values, aggregateFilter: " >=3 " })).toMatchObject({
      aggregateFilter: ">=3",
      aggregateFilterColumn: "$$count",
    });
  });

  it("keeps a chosen column", () => {
    expect(
      toStep({
        ...values,
        aggregateFilter: ">=100",
        aggregateFilterColumn: "amount",
      }),
    ).toMatchObject({ aggregateFilterColumn: "amount" });
  });
});

describe("toFormValues", () => {
  it("starts a new Population empty, in the default Data Source", () => {
    expect(toFormValues(null, "ds_1")).toEqual({
      name: "",
      description: "",
      datasource: "ds_1",
      userIdTypes: [],
      factTableId: "",
      rowFilters: [],
      aggregateFilterColumn: "",
      aggregateFilter: "",
    });
  });

  it("gives back the saved step when an existing Population is saved unchanged", () => {
    const savedStep: PopulationStep = {
      source: { type: "factTable", factTableId: "ftb_events" },
      rowFilters: [{ operator: "=", column: "country", values: ["US"] }],
      aggregateFilter: ">=3",
      aggregateFilterColumn: "amount",
    };
    const existing = {
      id: "pop_1",
      dateCreated: "",
      dateUpdated: "",
      projects: [],
      owner: "u_1",
      name: "Buyers",
      description: "",
      datasource: "ds_1",
      userIdTypes: ["user_id"],
      steps: [savedStep],
    };
    expect(toStep(toFormValues(existing, "ds_other"))).toEqual(savedStep);
  });
});
