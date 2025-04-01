import {
  ExperimentAnalysisSummaryResultsStatus,
  ExperimentAnalysisSummaryVariationStatus,
} from "back-end/types/experiment";
import {
  FactTableInterface,
  ColumnInterface,
  FactFilterInterface,
} from "back-end/types/fact-table";
import {
  getColumnRefWhereClause,
  canInlineFilterColumn,
  getAggregateFilters,
  getDecisionFrameworkStatus,
  getColumnExpression,
  getSelectedColumnDatatype,
} from "../src/experiments";

describe("Experiments", () => {
  describe("Fact Tables", () => {
    const column: ColumnInterface = {
      column: "event_name",
      datatype: "string",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      description: "The name of the event",
      numberFormat: "",
      name: "Event Name",
      alwaysInlineFilter: true,
      deleted: false,
    };
    const column2: ColumnInterface = {
      column: "page",
      datatype: "string",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      description: "The page location",
      numberFormat: "",
      name: "Page Location",
      deleted: false,
    };
    const userIdColumn: ColumnInterface = {
      column: "user_id",
      datatype: "string",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      description: "The user id",
      numberFormat: "",
      name: "User ID",
      deleted: false,
    };
    const numericColumn: ColumnInterface = {
      column: "event_count",
      datatype: "number",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      description: "The count of the event",
      numberFormat: "",
      name: "Event Count",
      deleted: false,
    };
    const jsonColumn: ColumnInterface = {
      column: "data",
      datatype: "json",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      description: "JSON data",
      numberFormat: "",
      name: "data",
      deleted: false,
      jsonFields: {
        a: { datatype: "string" },
        b: { datatype: "number" },
        "c.d": { datatype: "string" },
        "c.e": { datatype: "number" },
      },
    };
    const deletedColumn: ColumnInterface = {
      column: "deleted_column",
      datatype: "string",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      description: "The name of the event",
      numberFormat: "",
      name: "Deleted Column",
      deleted: true,
    };
    const filter: FactFilterInterface = {
      dateCreated: new Date(),
      dateUpdated: new Date(),
      description: "The name of the event",
      id: "filter_1",
      managedBy: "",
      name: "Event Name",
      value: "device='mobile'",
    };
    const filter2: FactFilterInterface = {
      dateCreated: new Date(),
      dateUpdated: new Date(),
      description: "The name of the event",
      id: "filter_2",
      managedBy: "",
      name: "Event Name",
      value: "country='us'",
    };
    const filter3: FactFilterInterface = {
      dateCreated: new Date(),
      dateUpdated: new Date(),
      description: "The name of the event",
      id: "filter_3",
      managedBy: "",
      name: "Event Name",
      value: "event_name = 'login'",
    };

    const factTable: Pick<
      FactTableInterface,
      "userIdTypes" | "columns" | "filters"
    > = {
      columns: [
        column,
        column2,
        userIdColumn,
        numericColumn,
        deletedColumn,
        jsonColumn,
      ],
      filters: [filter, filter2, filter3],
      userIdTypes: ["user_id"],
    };

    const escapeStringLiteral = (str: string) => str.replace(/'/g, "''");
    const jsonExtract = (jsonCol: string, path: string, isNumeric: boolean) => {
      if (isNumeric) {
        return `${jsonCol}:'${path}'::float`;
      }
      return `${jsonCol}:'${path}'`;
    };

    describe("canInlineFilterColumn", () => {
      it("returns true for string columns with alwaysInlineFilter", () => {
        expect(canInlineFilterColumn(factTable, column.column)).toBe(true);
      });
      it("returns true for string columns, even if alwaysInlineFilter is false", () => {
        expect(canInlineFilterColumn(factTable, column2.column)).toBe(true);
      });
      it("returns false for deleted columns", () => {
        expect(canInlineFilterColumn(factTable, deletedColumn.column)).toBe(
          false
        );
      });
      it("returns false for numeric columns", () => {
        expect(canInlineFilterColumn(factTable, numericColumn.column)).toBe(
          false
        );
      });
      it("returns false for userId columns", () => {
        expect(canInlineFilterColumn(factTable, userIdColumn.column)).toBe(
          false
        );
      });
      it("returns false for unknown column", () => {
        expect(canInlineFilterColumn(factTable, "unknown_column")).toBe(false);
      });
      it("returns true for nested JSON string field", () => {
        expect(canInlineFilterColumn(factTable, `${jsonColumn.column}.a`)).toBe(
          true
        );
      });
      it("returns false for nested JSON non-string field", () => {
        expect(canInlineFilterColumn(factTable, `${jsonColumn.column}.b`)).toBe(
          false
        );
      });
    });

    describe("getColumnRefWhereClause", () => {
      it("returns empty array when there are no filters", () => {
        expect(
          getColumnRefWhereClause(
            factTable,
            {
              column: "event_name",
              filters: [],
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract
          )
        ).toStrictEqual([]);

        expect(
          getColumnRefWhereClause(
            factTable,
            {
              column: "event_name",
              filters: [],
              inlineFilters: {},
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract
          )
        ).toStrictEqual([]);

        expect(
          getColumnRefWhereClause(
            factTable,
            {
              column: "event_name",
              filters: [],
              inlineFilters: {
                [column.column]: [],
              },
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract
          )
        ).toStrictEqual([]);

        expect(
          getColumnRefWhereClause(
            factTable,
            {
              column: "event_name",
              filters: [],
              inlineFilters: {
                [column.column]: [""],
              },
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract
          )
        ).toStrictEqual([]);
      });
      it("ignores invalid filters, but uses invalid inline filter columns", () => {
        expect(
          getColumnRefWhereClause(
            factTable,
            {
              column: column.column,
              filters: ["unknown_id"],
              factTableId: "",
              inlineFilters: {
                unknown_column: ["unknown_value"],
                [numericColumn.column]: ["1"],
                [deletedColumn.column]: ["deleted"],
                [userIdColumn.column]: ["user"],
              },
            },
            escapeStringLiteral,
            jsonExtract
          )
        ).toStrictEqual([
          "unknown_column = 'unknown_value'",
          `${numericColumn.column} = '1'`,
          `${deletedColumn.column} = 'deleted'`,
          `${userIdColumn.column} = 'user'`,
        ]);
      });
      it("returns where clause for single filter", () => {
        expect(
          getColumnRefWhereClause(
            factTable,
            {
              column: column.column,
              filters: [filter.id],
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract
          )
        ).toStrictEqual([filter.value]);
      });
      it("returns where clause for multiple filters", () => {
        expect(
          getColumnRefWhereClause(
            factTable,
            {
              column: column.column,
              filters: [filter.id, filter2.id],
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract
          )
        ).toStrictEqual([filter.value, filter2.value]);
      });
      it("returns where clause for single inline filter value", () => {
        expect(
          getColumnRefWhereClause(
            factTable,
            {
              column: column.column,
              filters: [],
              inlineFilters: {
                [column.column]: ["login"],
              },
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract
          )
        ).toStrictEqual([`${column.column} = 'login'`]);
      });
      it("returns where clause for multiple inline filter values", () => {
        expect(
          getColumnRefWhereClause(
            factTable,
            {
              column: column.column,
              filters: [],
              inlineFilters: {
                [column.column]: ["login", "signup"],
              },
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract
          )
        ).toStrictEqual([`${column.column} IN (\n  'login',\n  'signup'\n)`]);
      });
      it("returns where clause for inline filters and filters", () => {
        expect(
          getColumnRefWhereClause(
            factTable,
            {
              column: column.column,
              filters: [filter.id],
              inlineFilters: {
                [column.column]: ["login"],
              },
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract
          )
        ).toStrictEqual([`${column.column} = 'login'`, filter.value]);
      });
      it("escapes string literals", () => {
        expect(
          getColumnRefWhereClause(
            factTable,
            {
              column: column.column,
              filters: [],
              inlineFilters: {
                [column.column]: ["login's"],
              },
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract
          )
        ).toStrictEqual([`${column.column} = 'login''s'`]);
      });
      it("removes duplicate inline filter and filter values", () => {
        expect(
          getColumnRefWhereClause(
            factTable,
            {
              column: column.column,
              filters: [filter3.id],
              inlineFilters: {
                [column.column]: ["login"],
              },
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract
          )
        ).toStrictEqual([`${column.column} = 'login'`]);
      });
      it("removes duplicate inline filter values", () => {
        expect(
          getColumnRefWhereClause(
            factTable,
            {
              column: column.column,
              filters: [],
              inlineFilters: {
                [column.column]: ["login", "login"],
              },
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract
          )
        ).toStrictEqual([`${column.column} = 'login'`]);
      });
      it("supports JSON column inline filters", () => {
        expect(
          getColumnRefWhereClause(
            factTable,
            {
              column: `${jsonColumn.column}.b`,
              filters: [],
              inlineFilters: {
                [`${jsonColumn.column}.b`]: ["hello"],
              },
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract
          )
        ).toStrictEqual([`${jsonColumn.column}:'b'::float = 'hello'`]);
      });
    });
    describe("getAggregateFilter", () => {
      it("returns empty array for empty input", () => {
        expect(
          getAggregateFilters({
            columnRef: null,
            column: "value",
          })
        ).toStrictEqual([]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: ">10",
              aggregateFilterColumn: "",
            },
            column: "value",
          })
        ).toStrictEqual([]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: "",
              aggregateFilterColumn: "v",
            },
            column: "value",
          })
        ).toStrictEqual([]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: " ",
              aggregateFilterColumn: "v",
            },
            column: "value",
          })
        ).toStrictEqual([]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: " , ",
              aggregateFilterColumn: "v",
            },
            column: "value",
          })
        ).toStrictEqual([]);
      });
      it("parses a single filter with different operators", () => {
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: "> 0",
              aggregateFilterColumn: "v",
            },
            column: "value",
          })
        ).toStrictEqual(["value > 0"]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: " < 5,",
              aggregateFilterColumn: "v",
            },
            column: "value",
          })
        ).toStrictEqual(["value < 5"]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: ">= 10",
              aggregateFilterColumn: "v",
            },
            column: "value",
          })
        ).toStrictEqual(["value >= 10"]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: "<= 15",
              aggregateFilterColumn: "v",
            },
            column: "value",
          })
        ).toStrictEqual(["value <= 15"]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: "=1.5",
              aggregateFilterColumn: "v",
            },
            column: "value",
          })
        ).toStrictEqual(["value = 1.5"]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: "!=0.15",
              aggregateFilterColumn: "v",
            },
            column: "value",
          })
        ).toStrictEqual(["value != 0.15"]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: "<> 0.15",
              aggregateFilterColumn: "v",
            },
            column: "value",
          })
        ).toStrictEqual(["value <> 0.15"]);
      });
      it("parses multiple filters", () => {
        expect(
          getAggregateFilters({
            columnRef: {
              aggregateFilter:
                ",> 0, < 5 , >= 10, <= 15, =1.5, !=0.15,,, <> 0.15",
              column: "$$distinctUsers",
              aggregateFilterColumn: "v",
            },
            column: "value",
          })
        ).toStrictEqual([
          "value > 0",
          "value < 5",
          "value >= 10",
          "value <= 15",
          "value = 1.5",
          "value != 0.15",
          "value <> 0.15",
        ]);
      });
      it("throws by default", () => {
        expect(() =>
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: ">5, %3, foobar,,,",
              aggregateFilterColumn: "v",
            },
            column: "value",
          })
        ).toThrowError("Invalid user filter: %3");
      });
      it("ignores invalid filters when opted in", () => {
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: ">5, %3, foobar,,,",
              aggregateFilterColumn: "v",
            },
            column: "col",
            ignoreInvalid: true,
          })
        ).toStrictEqual(["col > 5"]);
      });
      it("skips when column is not $$distinctUsers", () => {
        expect(
          getAggregateFilters({
            columnRef: {
              column: "col",
              aggregateFilter: ">5",
              aggregateFilterColumn: "v",
            },
            column: "value",
          })
        ).toStrictEqual([]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$count",
              aggregateFilter: ">5",
              aggregateFilterColumn: "v",
            },
            column: "value",
          })
        ).toStrictEqual([]);
      });
    });

    describe("getColumnExpression", () => {
      it("replaces JSON column access with proper syntax", () => {
        expect(
          getColumnExpression(`${jsonColumn.column}.a`, factTable, jsonExtract)
        ).toBe(`${jsonColumn.column}:'a'`);

        expect(
          getColumnExpression(`${jsonColumn.column}.b`, factTable, jsonExtract)
        ).toBe(`${jsonColumn.column}:'b'::float`);

        expect(
          getColumnExpression(
            `${jsonColumn.column}.c.d`,
            factTable,
            jsonExtract
          )
        ).toBe(`${jsonColumn.column}:'c.d'`);

        expect(
          getColumnExpression(
            `${jsonColumn.column}.c.e`,
            factTable,
            jsonExtract
          )
        ).toBe(`${jsonColumn.column}:'c.e'::float`);
      });

      it("returns untransformed column for non-JSON columns", () => {
        expect(getColumnExpression(column.column, factTable, jsonExtract)).toBe(
          column.column
        );
      });

      it("returns untransformed column for unknown columns", () => {
        expect(
          getColumnExpression("unknown_column", factTable, jsonExtract)
        ).toBe("unknown_column");
      });

      it("supports aliases", () => {
        expect(
          getColumnExpression(
            `${jsonColumn.column}.b`,
            factTable,
            jsonExtract,
            "m"
          )
        ).toBe(`m.${jsonColumn.column}:'b'::float`);

        expect(
          getColumnExpression(column.column, factTable, jsonExtract, "m")
        ).toBe(`m.${column.column}`);

        expect(
          getColumnExpression("unknown", factTable, jsonExtract, "m")
        ).toBe(`m.unknown`);
      });

      it("assumes datatype of string for unknown JSON fields", () => {
        expect(
          getColumnExpression(
            `${jsonColumn.column}.unknown`,
            factTable,
            jsonExtract
          )
        ).toBe(`${jsonColumn.column}:'unknown'`);

        expect(
          getColumnExpression(
            `${jsonColumn.column}.c.unknown`,
            factTable,
            jsonExtract
          )
        ).toBe(`${jsonColumn.column}:'c.unknown'`);

        expect(
          getColumnExpression(
            `${jsonColumn.column}.unknown.unknown`,
            factTable,
            jsonExtract
          )
        ).toBe(`${jsonColumn.column}:'unknown.unknown'`);
      });
    });
    describe("getSelectedColumnDatatype", () => {
      it("returns the datatype of the selected column", () => {
        expect(
          getSelectedColumnDatatype({ factTable, column: column.column })
        ).toBe(column.datatype);
        expect(
          getSelectedColumnDatatype({ factTable, column: column2.column })
        ).toBe(column2.datatype);
        expect(
          getSelectedColumnDatatype({ factTable, column: userIdColumn.column })
        ).toBe(userIdColumn.datatype);
        expect(
          getSelectedColumnDatatype({ factTable, column: numericColumn.column })
        ).toBe(numericColumn.datatype);
        expect(
          getSelectedColumnDatatype({ factTable, column: deletedColumn.column })
        ).toBe(deletedColumn.datatype);
        expect(
          getSelectedColumnDatatype({ factTable, column: jsonColumn.column })
        ).toBe(jsonColumn.datatype);
      });

      it("supports nested JSON fields", () => {
        expect(
          getSelectedColumnDatatype({
            factTable,
            column: `${jsonColumn.column}.a`,
          })
        ).toBe("string");
        expect(
          getSelectedColumnDatatype({
            factTable,
            column: `${jsonColumn.column}.b`,
          })
        ).toBe("number");
        expect(
          getSelectedColumnDatatype({
            factTable,
            column: `${jsonColumn.column}.c.d`,
          })
        ).toBe("string");
        expect(
          getSelectedColumnDatatype({
            factTable,
            column: `${jsonColumn.column}.c.e`,
          })
        ).toBe("number");
      });

      it("returns undefined for unknown columns", () => {
        expect(
          getSelectedColumnDatatype({ factTable, column: "unknown" })
        ).toBe(undefined);

        expect(
          getSelectedColumnDatatype({
            factTable,
            column: `${jsonColumn.column}.unknown`,
          })
        ).toBe(undefined);
      });

      it("Can exclude deleted columns", () => {
        expect(
          getSelectedColumnDatatype({
            factTable,
            column: deletedColumn.column,
            excludeDeleted: true,
          })
        ).toBe(undefined);
      });
    });
  });
});

function setMetricsOnResultsStatus({
  resultsStatus,
  goalMetrics,
  guardrailMetrics,
  secondVariation,
}: {
  resultsStatus: ExperimentAnalysisSummaryResultsStatus;
  goalMetrics?: ExperimentAnalysisSummaryVariationStatus["goalMetrics"];
  guardrailMetrics?: ExperimentAnalysisSummaryVariationStatus["guardrailMetrics"];
  secondVariation?: ExperimentAnalysisSummaryVariationStatus;
}): ExperimentAnalysisSummaryResultsStatus {
  return {
    ...resultsStatus,
    variations: [
      {
        ...resultsStatus.variations[0],
        ...(goalMetrics ? { goalMetrics: goalMetrics } : {}),
        ...(guardrailMetrics ? { guardrailMetrics: guardrailMetrics } : {}),
      },
      ...(secondVariation ? [secondVariation] : []),
    ],
  };
}

describe("decision tree is correct", () => {
  const resultsStatus: ExperimentAnalysisSummaryResultsStatus = {
    variations: [
      {
        variationId: "1",
        goalMetrics: {},
        guardrailMetrics: {},
      },
    ],
    settings: { sequentialTesting: false },
  };
  it("returns the correct underpowered decisions", () => {
    const daysNeeded = undefined;

    // winning stat sig not enough to trigger any rec
    const noDecision = getDecisionFrameworkStatus({
      resultsStatus: setMetricsOnResultsStatus({
        resultsStatus,
        goalMetrics: { "1": { status: "won", superStatSigStatus: "neutral" } },
      }),
      goalMetrics: ["1"],
      guardrailMetrics: [],
      daysNeeded,
    });
    expect(noDecision).toEqual(undefined);

    // losing stat sig not enough to trigger any rec
    const noNegDecision = getDecisionFrameworkStatus({
      resultsStatus: setMetricsOnResultsStatus({
        resultsStatus,
        goalMetrics: { "1": { status: "lost", superStatSigStatus: "neutral" } },
      }),
      goalMetrics: ["1"],
      guardrailMetrics: [],
      daysNeeded,
    });
    expect(noNegDecision).toEqual(undefined);

    // super stat sig triggers rec
    const shipDecision = getDecisionFrameworkStatus({
      resultsStatus: setMetricsOnResultsStatus({
        resultsStatus,
        goalMetrics: { "1": { status: "won", superStatSigStatus: "won" } },
      }),
      goalMetrics: ["1"],
      guardrailMetrics: [],
      daysNeeded,
    });
    expect(shipDecision?.status).toEqual("ship-now");

    // super stat sig triggers rec with guardrail failure
    const discussDecision = getDecisionFrameworkStatus({
      resultsStatus: setMetricsOnResultsStatus({
        resultsStatus,
        goalMetrics: { "1": { status: "won", superStatSigStatus: "won" } },
        guardrailMetrics: {
          "01": { status: "lost" },
        },
      }),
      goalMetrics: ["1"],
      guardrailMetrics: ["01"],
      daysNeeded: undefined,
    });
    expect(discussDecision?.status).toEqual("ready-for-review");
    expect(discussDecision?.tooltip).toMatch(
      "However, one or more guardrails are failing"
    );

    // losing super stat sig triggers rec
    const negDecision = getDecisionFrameworkStatus({
      resultsStatus: setMetricsOnResultsStatus({
        resultsStatus,
        goalMetrics: { "1": { status: "lost", superStatSigStatus: "lost" } },
      }),
      goalMetrics: ["1"],
      guardrailMetrics: [],
      daysNeeded,
    });
    expect(negDecision?.status).toEqual("rollback-now");

    // losing super stat sig on one variation not enough
    const somewhatNegDecision = getDecisionFrameworkStatus({
      resultsStatus: setMetricsOnResultsStatus({
        resultsStatus,
        goalMetrics: { "1": { status: "lost", superStatSigStatus: "lost" } },
        secondVariation: {
          variationId: "2",
          goalMetrics: {
            "1": { status: "neutral", superStatSigStatus: "neutral" },
          },
          guardrailMetrics: {},
        },
      }),
      goalMetrics: ["1"],
      guardrailMetrics: [],
      daysNeeded,
    });
    expect(somewhatNegDecision).toEqual(undefined);
  });

  it("returns the correct powered decisions", () => {
    const daysNeeded = 0;

    // winning stat sig enough to trigger rec
    const decision = getDecisionFrameworkStatus({
      resultsStatus: setMetricsOnResultsStatus({
        resultsStatus,
        goalMetrics: { "1": { status: "won", superStatSigStatus: "neutral" } },
      }),
      goalMetrics: ["1"],
      guardrailMetrics: [],
      daysNeeded,
    });
    expect(decision?.status).toEqual("ship-now");

    // neutral triggers no decision
    const noDecision = getDecisionFrameworkStatus({
      resultsStatus: setMetricsOnResultsStatus({
        resultsStatus,
        goalMetrics: {
          "1": { status: "neutral", superStatSigStatus: "neutral" },
        },
      }),
      goalMetrics: ["1"],
      guardrailMetrics: [],
      daysNeeded,
    });
    expect(noDecision?.status).toEqual("ready-for-review");

    // Guardrail failure suggests reviewing
    const guardrailDecision = getDecisionFrameworkStatus({
      resultsStatus: setMetricsOnResultsStatus({
        resultsStatus,
        guardrailMetrics: { "01": { status: "lost" } },
      }),
      goalMetrics: ["1"],
      guardrailMetrics: ["01"],
      daysNeeded,
    });
    expect(guardrailDecision?.status).toEqual("ready-for-review");

    // losing stat sig enough to trigger any rec
    const negDecision = getDecisionFrameworkStatus({
      resultsStatus: setMetricsOnResultsStatus({
        resultsStatus,
        goalMetrics: { "1": { status: "lost", superStatSigStatus: "neutral" } },
      }),
      goalMetrics: ["1"],
      guardrailMetrics: [],
      daysNeeded,
    });
    expect(negDecision?.status).toEqual("rollback-now");

    // losing stat sig in two variations also triggers a rec
    const negDecisionTwoVar = getDecisionFrameworkStatus({
      resultsStatus: setMetricsOnResultsStatus({
        resultsStatus,
        goalMetrics: { "1": { status: "lost", superStatSigStatus: "neutral" } },
        secondVariation: {
          variationId: "2",
          goalMetrics: {
            "1": { status: "lost", superStatSigStatus: "neutral" },
          },
          guardrailMetrics: {},
        },
      }),
      goalMetrics: ["1"],
      guardrailMetrics: [],
      daysNeeded,
    });
    expect(negDecisionTwoVar?.status).toEqual("rollback-now");

    // losing stat sig in only one variation not enough, leads to ready for review
    const ambiguousDecisionTwoVar = getDecisionFrameworkStatus({
      resultsStatus: setMetricsOnResultsStatus({
        resultsStatus,
        goalMetrics: { "1": { status: "lost", superStatSigStatus: "neutral" } },
        secondVariation: {
          variationId: "2",
          goalMetrics: {
            "1": { status: "neutral", superStatSigStatus: "neutral" },
          },
          guardrailMetrics: {},
        },
      }),
      goalMetrics: ["1"],
      guardrailMetrics: [],
      daysNeeded,
    });
    expect(ambiguousDecisionTwoVar?.status).toEqual("ready-for-review");
  });
});
