import type { PopulationStep } from "shared/validators";
import type { PopulationRuleFactTable } from "shared/populations";
import {
  getDefaultPopulationUserIdType,
  getPopulationDraftIssue,
  newPopulationStep,
  PopulationDraft,
} from "@/components/Populations/populationDraft";

function step(
  factTableId: string,
  overrides: Partial<PopulationStep> = {},
): PopulationStep {
  return {
    ...newPopulationStep(),
    source: { type: "factTable", factTableId },
    ...overrides,
  };
}

describe("getDefaultPopulationUserIdType", () => {
  const factTables = [
    { datasource: "ds_1", userIdTypes: ["user_id"] },
    { datasource: "ds_1", userIdTypes: ["user_id", "anonymous_id"] },
    { datasource: "ds_2", userIdTypes: ["anonymous_id"] },
    { datasource: "ds_2", userIdTypes: ["anonymous_id"] },
  ];

  it("picks the type the most fact tables in the Data Source support", () => {
    expect(
      getDefaultPopulationUserIdType(
        ["anonymous_id", "user_id"],
        factTables,
        "ds_1",
      ),
    ).toBe("user_id");
  });

  it("keeps the Data Source order on a tie", () => {
    expect(
      getDefaultPopulationUserIdType(["device_id", "user_id"], [], "ds_1"),
    ).toBe("device_id");
  });

  it("returns null when the Data Source has no identifier types", () => {
    expect(getDefaultPopulationUserIdType([], factTables, "ds_1")).toBeNull();
  });
});

describe("newPopulationStep", () => {
  it("starts at any time with no filters", () => {
    expect(newPopulationStep()).toEqual({
      source: { type: "factTable", factTableId: "" },
      rowFilters: [],
      windowSettings: {
        type: "",
        delayValue: 0,
        delayUnit: "days",
        windowValue: 0,
        windowUnit: "days",
      },
    });
  });
});

describe("getPopulationDraftIssue", () => {
  const factTable = (
    id: string,
    extra: Partial<PopulationRuleFactTable> = {},
  ): PopulationRuleFactTable => ({
    id,
    datasource: "ds_1",
    userIdTypes: ["user_id"],
    columns: [],
    ...extra,
  });
  const factTables = [factTable("a")];
  const complete: PopulationDraft = {
    name: "Buyers",
    description: "",
    datasource: "ds_1",
    userIdTypes: ["user_id"],
    step: step("a"),
  };
  const issue = (draft: PopulationDraft, tables = factTables) =>
    getPopulationDraftIssue(draft, tables);

  it("accepts a complete draft", () => {
    expect(issue(complete)).toBeNull();
  });

  it("requires a name", () => {
    expect(issue({ ...complete, name: "  " })).toBe("Enter a name.");
  });

  it("requires a fact table", () => {
    expect(issue({ ...complete, step: step("") })).toBe("Choose a fact table.");
  });

  it("requires complete row filters", () => {
    expect(
      issue({
        ...complete,
        step: step("a", {
          rowFilters: [{ column: "country", operator: "=", values: [""] }],
        }),
      }),
    ).toBe("Finish the row filter.");
  });

  it("requires a valid aggregate filter when a column is set", () => {
    const withAggregate = (aggregateFilter: string) => ({
      ...complete,
      step: step("a", { aggregateFilterColumn: "$$count", aggregateFilter }),
    });
    expect(issue(withAggregate(">="))).toBe("Finish the aggregate filter.");
    expect(issue(withAggregate(">=3,<10"))).toBeNull();
  });

  it("requires a window length when a window is set", () => {
    expect(
      issue({
        ...complete,
        step: step("a", {
          windowSettings: {
            ...complete.step.windowSettings,
            type: "lookback",
            windowValue: 0,
          },
        }),
      }),
    ).toBe("Enter a window length.");
  });

  it("flags a fact table that doesn't support the identifier type", () => {
    expect(issue({ ...complete, userIdTypes: ["anonymous_id"] })).toBe(
      "Fact table a does not support identifier types: anonymous_id.",
    );
  });

  it("checks JSON sub-field aggregates against the column's jsonFields", () => {
    const withAggregate = (aggregateFilterColumn: string) => ({
      ...complete,
      step: step("a", { aggregateFilterColumn, aggregateFilter: ">=1" }),
    });
    const tables = [
      factTable("a", {
        columns: [
          {
            dateCreated: new Date(0),
            dateUpdated: new Date(0),
            name: "props",
            description: "",
            column: "props",
            datatype: "json",
            numberFormat: "",
            deleted: false,
            jsonFields: {
              quantity: { datatype: "number" },
              coupon: { datatype: "string" },
            },
          },
        ],
      }),
    ];
    expect(issue(withAggregate("props.quantity"), tables)).toBeNull();
    expect(issue(withAggregate("props.coupon"), tables)).toBe(
      `Aggregate filter column 'props.coupon' must be a numeric column or "$$count" (step 1).`,
    );
  });
});
