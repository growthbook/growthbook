import { FactTableInterface } from "shared/types/fact-table";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import {
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
    it("returns SQL expressions for sql_expr and saved_filter operators only", () => {
      const expressions = getRiskyRowFilterSqlExpressions(
        [
          { operator: "=", column: "country", values: ["US"] },
          { operator: "sql_expr", values: ["amount > 100"] },
          { operator: "saved_filter", values: ["filter_country_us"] },
        ],
        factTable,
      );

      expect(expressions).toEqual(["(amount > 100)", "(country = 'US')"]);
    });

    it("ignores empty or unresolved risky operators", () => {
      const expressions = getRiskyRowFilterSqlExpressions(
        [
          { operator: "sql_expr", values: ["   "] },
          { operator: "saved_filter", values: ["missing_filter"] },
          { operator: "saved_filter", values: [] },
        ],
        factTable,
      );

      expect(expressions).toEqual([]);
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
        testQueryDays: 14,
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
          testQueryDays: 14,
          errorPrefix: "Invalid row filter SQL: ",
        }),
      ).resolves.toBeUndefined();
    });

    it("runs a LIMIT-0 validity query for risky filters", async () => {
      const integration = {
        getTestValidityQuery: jest
          .fn()
          .mockReturnValue("SELECT * FROM __table LIMIT 0"),
        runTestQuery: jest.fn().mockResolvedValue({ results: [] }),
      } as unknown as SourceIntegrationInterface;

      await validateFactMetricRowFilterSql({
        integration,
        factTable,
        rowFilters: [
          { operator: "saved_filter", values: ["filter_country_us"] },
          { operator: "sql_expr", values: ["amount > 100"] },
        ],
        testQueryDays: 14,
        errorPrefix: "Invalid row filter SQL: ",
      });

      expect(integration.getTestValidityQuery).toHaveBeenCalledWith(
        expect.stringContaining(
          "WHERE (country = 'US') AND (amount > 100)",
        ),
        14,
        { eventName: "orders" },
      );
      expect(integration.runTestQuery).toHaveBeenCalledWith(
        "SELECT * FROM __table LIMIT 0",
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
          testQueryDays: 14,
          errorPrefix: "Invalid numerator row filter SQL: ",
        }),
      ).rejects.toThrow("Invalid numerator row filter SQL: Syntax error near ')'");
    });
  });
});
