import {
  ColumnInterface,
  ColumnRef,
  FactMetricType,
  FactTableColumnType,
  FactTableInterface,
} from "shared/types/fact-table";
import { validateAggregationSpecification } from "back-end/src/services/factMetricAggregationValidation";

function makeColumn(
  column: string,
  datatype: FactTableColumnType,
): ColumnInterface {
  return {
    column,
    name: column,
    description: "",
    datatype,
    numberFormat: "",
    deleted: false,
    dateCreated: new Date("2020-01-01"),
    dateUpdated: new Date("2020-01-01"),
  };
}

function makeFactTable(
  overrides: Partial<FactTableInterface> = {},
): FactTableInterface {
  return {
    organization: "org_1",
    id: "ft_1",
    name: "Orders",
    description: "",
    owner: "",
    projects: [],
    tags: [],
    datasource: "ds_1",
    userIdTypes: ["user_id"],
    sql: "SELECT * FROM orders",
    eventName: "",
    columns: [],
    filters: [],
    dateCreated: new Date("2020-01-01"),
    dateUpdated: new Date("2020-01-01"),
    ...overrides,
  };
}

function validate({
  column,
  factTable,
  metricType = "mean",
}: {
  column: ColumnRef;
  factTable: FactTableInterface;
  metricType?: FactMetricType;
}): void {
  validateAggregationSpecification({
    column,
    factTable,
    metricType,
    quantileType: undefined,
    quantileIgnoreZeros: undefined,
    quantileEventCountColumn: undefined,
    errorPrefix: "",
  });
}

describe("validateAggregationSpecification column-detection guard", () => {
  it("throws a 'still being detected' error for a concrete column whose type is unknown while a refresh is pending", () => {
    const factTable = makeFactTable({
      columns: [makeColumn("amount", "")],
      columnRefreshPending: true,
    });
    expect(() =>
      validate({
        column: { factTableId: "ft_1", column: "amount" },
        factTable,
      }),
    ).toThrow(/still being detected/);
  });

  it("throws a 'Column detection failed' error for a concrete unknown-type column after detection failed", () => {
    const factTable = makeFactTable({
      columns: [makeColumn("amount", "")],
      columnRefreshPending: false,
      columnsError: "SQL compilation error",
    });
    expect(() =>
      validate({
        column: { factTableId: "ft_1", column: "amount" },
        factTable,
      }),
    ).toThrow(/Column detection failed/);
  });

  it.each(["$$count", "$$distinctUsers", "$$distinctDates"])(
    "does not fire the guard for the supported special ref %s while a refresh is pending",
    (column) => {
      const factTable = makeFactTable({
        columns: [makeColumn("amount", "")],
        columnRefreshPending: true,
      });
      expect(() =>
        validate({
          column: { factTableId: "ft_1", column },
          factTable,
        }),
      ).not.toThrow();
    },
  );

  it("treats an unsupported $$ reference as a named column while a refresh is pending", () => {
    const factTable = makeFactTable({
      columnRefreshPending: true,
    });
    expect(() =>
      validate({
        column: { factTableId: "ft_1", column: "$$unsupported" },
        factTable,
      }),
    ).toThrow(/still being detected/);
  });

  it("still throws the existing aggregation error for a known-typed column (count distinct on a number column)", () => {
    const factTable = makeFactTable({
      columns: [makeColumn("amount", "number")],
      // pending true to prove the guard does not preempt a known-typed column
      columnRefreshPending: true,
    });
    expect(() =>
      validate({
        column: {
          factTableId: "ft_1",
          column: "amount",
          aggregation: "count distinct",
        },
        factTable,
      }),
    ).toThrow(/count distinct/);
  });

  it("passes a known-typed string column using count distinct", () => {
    const factTable = makeFactTable({
      columns: [makeColumn("country", "string")],
      columnRefreshPending: true,
    });
    expect(() =>
      validate({
        column: {
          factTableId: "ft_1",
          column: "country",
          aggregation: "count distinct",
        },
        factTable,
      }),
    ).not.toThrow();
  });
});
