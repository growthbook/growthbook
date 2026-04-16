import { FactTableInterface } from "shared/types/fact-table";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import {
  getNetNewSqlExprRowFilters,
  getRiskyRowFilterSqlExpressions,
  validateFactMetricRowFilterSql,
} from "back-end/src/services/factMetricRowFilterValidation";

const now = new Date();

const factTable: Pick<FactTableInterface, "sql" | "eventName" | "filters"> = {
  sql: "SELECT user_id, country, amount FROM orders",
  eventName: "orders",
  filters: [
    {
      id: "filter_country_us",
      name: "Country is US",
      description: "",
      value: "country = 'US'",
      dateCreated: now,
      dateUpdated: now,
      managedBy: "",
    },
  ],
};

describe("factMetricRowFilterValidation", () => {
  describe("getRiskyRowFilterSqlExpressions", () => {
    it("returns SQL expressions for sql_expr operators only", () => {
      const expressions = getRiskyRowFilterSqlExpressions([
        { operator: "=", column: "country", values: ["US"] },
        { operator: "sql_expr", values: ["amount > 100"] },
        { operator: "saved_filter", values: ["filter_country_us"] },
      ]);

      expect(expressions).toEqual(["(amount > 100\n)"]);
    });

    it("adds a newline before closing parens for line comments", () => {
      const expressions = getRiskyRowFilterSqlExpressions([
        {
          operator: "sql_expr",
          values: ["amount > 100 -- keep users with large order values"],
        },
      ]);

      expect(expressions).toEqual([
        "(amount > 100 -- keep users with large order values\n)",
      ]);
    });

    it("ignores empty or unresolved risky operators", () => {
      const expressions = getRiskyRowFilterSqlExpressions([
        { operator: "sql_expr", values: ["   "] },
        { operator: "saved_filter", values: ["missing_filter"] },
        { operator: "saved_filter", values: [] },
      ]);

      expect(expressions).toEqual([]);
    });
  });

  describe("getNetNewSqlExprRowFilters", () => {
    it("returns all sql_expr filters if there is no previous metric", () => {
      const filters = getNetNewSqlExprRowFilters({
        rowFilters: [
          { operator: "sql_expr", values: ["amount > 100"] },
          { operator: "saved_filter", values: ["filter_country_us"] },
        ],
        previousRowFilters: undefined,
      });

      expect(filters).toEqual([
        { operator: "sql_expr", values: ["amount > 100"] },
      ]);
    });

    it("returns only net new sql_expr filters on update", () => {
      const filters = getNetNewSqlExprRowFilters({
        rowFilters: [
          { operator: "sql_expr", values: ["amount > 100"] },
          { operator: "sql_expr", values: ["country = 'US'"] },
        ],
        previousRowFilters: [
          { operator: "sql_expr", values: ["amount > 100"] },
          { operator: "saved_filter", values: ["filter_country_us"] },
        ],
      });

      expect(filters).toEqual([
        { operator: "sql_expr", values: ["country = 'US'"] },
      ]);
    });

    it("can force-validate all sql_expr filters when context changes", () => {
      const filters = getNetNewSqlExprRowFilters({
        rowFilters: [{ operator: "sql_expr", values: ["amount > 100"] }],
        previousRowFilters: [
          { operator: "sql_expr", values: ["amount > 100"] },
        ],
        validateAll: true,
      });

      expect(filters).toEqual([
        { operator: "sql_expr", values: ["amount > 100"] },
      ]);
    });
  });

  describe("validateFactMetricRowFilterSql", () => {
    it("skips validation when there are no risky operators", async () => {
      const integration = {
        getTestValidityQuery: jest.fn(),
        runTestQuery: jest.fn(),
      } as unknown as SourceIntegrationInterface;

      await validateFactMetricRowFilterSql({
        integration,
        factTable,
        rowFilters: [{ operator: "in", column: "country", values: ["US"] }],
        errorPrefix: "Invalid row filter SQL: ",
      });

      expect(integration.getTestValidityQuery).not.toHaveBeenCalled();
      expect(integration.runTestQuery).not.toHaveBeenCalled();
    });

    it("skips validation when integration does not support test queries", async () => {
      await expect(
        validateFactMetricRowFilterSql({
          integration: {} as SourceIntegrationInterface,
          factTable,
          rowFilters: [{ operator: "sql_expr", values: ["amount > 100"] }],
          errorPrefix: "Invalid row filter SQL: ",
        }),
      ).resolves.toBeUndefined();
    });

    it("runs a validity query for sql_expr filters only", async () => {
      const getTestValidityQuery = jest
        .fn()
        .mockReturnValue("SELECT * FROM __table LIMIT 0");
      const runTestQuery = jest.fn().mockResolvedValue({ results: [] });
      const integration = {
        getTestValidityQuery,
        runTestQuery,
      } as unknown as SourceIntegrationInterface;

      await validateFactMetricRowFilterSql({
        integration,
        factTable,
        rowFilters: [
          { operator: "saved_filter", values: ["filter_country_us"] },
          { operator: "sql_expr", values: ["amount > 100"] },
        ],
        errorPrefix: "Invalid row filter SQL: ",
      });

      const [query, testDays, templateVariables] =
        getTestValidityQuery.mock.calls[0];
      expect(query).toContain("WHERE (amount > 100\n)");
      expect(query).not.toContain("country = 'US'");
      expect(testDays).toBe(1);
      expect(templateVariables).toEqual({ eventName: "orders" });
      expect(runTestQuery).toHaveBeenCalledWith(
        "SELECT * FROM __table LIMIT 0",
        undefined,
        "factTableValidation",
      );
    });

    it("throws a prefixed error when validation query fails", async () => {
      const integration = {
        getTestValidityQuery: jest.fn().mockReturnValue("SELECT 1"),
        runTestQuery: jest
          .fn()
          .mockRejectedValue(new Error("Syntax error near ')'")),
      } as unknown as SourceIntegrationInterface;

      await expect(
        validateFactMetricRowFilterSql({
          integration,
          factTable,
          rowFilters: [{ operator: "sql_expr", values: ["amount > )"] }],
          errorPrefix: "Invalid numerator row filter SQL: ",
        }),
      ).rejects.toThrow(
        "Invalid numerator row filter SQL: Syntax error near ')'",
      );
    });
  });
});
