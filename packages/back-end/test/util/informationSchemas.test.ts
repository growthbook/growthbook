import { getPath } from "../../src/util/informationSchemas";

describe("informationSchemas", () => {
  describe("getPath", () => {
    // Test basic functionality for each data source type
    // Note: getPath now only handles table paths with required catalog, schema, and tableName

    describe("mysql", () => {
      it("should handle basic table path", () => {
        expect(
          getPath("mysql", {
            catalog: "catalog",
            schema: "schema",
            tableName: "table",
          })
        ).toBe("`schema`.`table`");
      });

      it("should handle reserved words safely", () => {
        expect(
          getPath("mysql", {
            catalog: "catalog",
            schema: "order",
            tableName: "select",
          })
        ).toBe("`order`.`select`");
      });
    });

    describe("clickhouse", () => {
      it("should handle basic table path", () => {
        expect(
          getPath("clickhouse", {
            catalog: "catalog",
            schema: "schema",
            tableName: "table",
          })
        ).toBe("`schema`.`table`");
      });

      it("should handle reserved words safely", () => {
        expect(
          getPath("clickhouse", {
            catalog: "catalog",
            schema: "order",
            tableName: "select",
          })
        ).toBe("`order`.`select`");
      });
    });

    describe("bigquery", () => {
      it("should handle basic table path", () => {
        expect(
          getPath("bigquery", {
            catalog: "catalog",
            schema: "schema",
            tableName: "table",
          })
        ).toBe("`catalog.schema.table`");
      });

      it("should handle special characters", () => {
        expect(
          getPath("bigquery", {
            catalog: "project-123",
            schema: "dataset_name",
            tableName: "table-name",
          })
        ).toBe("`project-123.dataset_name.table-name`");
      });
    });

    describe("growthbook_clickhouse", () => {
      it("should return only table name", () => {
        expect(
          getPath("growthbook_clickhouse", {
            catalog: "catalog",
            schema: "schema",
            tableName: "table",
          })
        ).toBe("table");
      });

      it("should handle special table names", () => {
        expect(
          getPath("growthbook_clickhouse", {
            catalog: "catalog",
            schema: "schema",
            tableName: "my-special-table",
          })
        ).toBe("my-special-table");
      });
    });

    describe("postgres", () => {
      it("should handle basic table path", () => {
        expect(
          getPath("postgres", {
            catalog: "catalog",
            schema: "schema",
            tableName: "table",
          })
        ).toBe("catalog.schema.table");
      });

      it("should handle complex names", () => {
        expect(
          getPath("postgres", {
            catalog: "my_database",
            schema: "public",
            tableName: "user_events",
          })
        ).toBe("my_database.public.user_events");
      });
    });

    describe("snowflake", () => {
      it("should handle basic table path", () => {
        expect(
          getPath("snowflake", {
            catalog: "catalog",
            schema: "schema",
            tableName: "table",
          })
        ).toBe("catalog.schema.table");
      });

      it("should handle uppercase names", () => {
        expect(
          getPath("snowflake", {
            catalog: "PROD_DB",
            schema: "ANALYTICS",
            tableName: "USER_EVENTS",
          })
        ).toBe("PROD_DB.ANALYTICS.USER_EVENTS");
      });
    });

    describe("redshift", () => {
      it("should handle basic table path", () => {
        expect(
          getPath("redshift", {
            catalog: "catalog",
            schema: "schema",
            tableName: "table",
          })
        ).toBe("catalog.schema.table");
      });

      it("should handle schema-less tables", () => {
        expect(
          getPath("redshift", {
            catalog: "mydb",
            schema: "public",
            tableName: "events",
          })
        ).toBe("mydb.public.events");
      });
    });

    describe("athena", () => {
      it("should handle basic table path", () => {
        expect(
          getPath("athena", {
            catalog: "catalog",
            schema: "schema",
            tableName: "table",
          })
        ).toBe("catalog.schema.table");
      });

      it("should handle AWS Glue catalog names", () => {
        expect(
          getPath("athena", {
            catalog: "awsdatacatalog",
            schema: "default",
            tableName: "cloudtrail_logs",
          })
        ).toBe("awsdatacatalog.default.cloudtrail_logs");
      });
    });

    describe("mssql", () => {
      it("should handle basic table path", () => {
        expect(
          getPath("mssql", {
            catalog: "catalog",
            schema: "schema",
            tableName: "table",
          })
        ).toBe("catalog.schema.table");
      });

      it("should handle SQL Server naming", () => {
        expect(
          getPath("mssql", {
            catalog: "MyDatabase",
            schema: "dbo",
            tableName: "Users",
          })
        ).toBe("MyDatabase.dbo.Users");
      });
    });

    describe("presto", () => {
      it("should handle basic table path", () => {
        expect(
          getPath("presto", {
            catalog: "catalog",
            schema: "schema",
            tableName: "table",
          })
        ).toBe("catalog.schema.table");
      });

      it("should handle Presto catalog names", () => {
        expect(
          getPath("presto", {
            catalog: "hive",
            schema: "default",
            tableName: "web_logs",
          })
        ).toBe("hive.default.web_logs");
      });
    });

    describe("databricks", () => {
      it("should handle basic table path", () => {
        expect(
          getPath("databricks", {
            catalog: "catalog",
            schema: "schema",
            tableName: "table",
          })
        ).toBe("catalog.schema.table");
      });

      it("should handle Unity Catalog names", () => {
        expect(
          getPath("databricks", {
            catalog: "main",
            schema: "analytics",
            tableName: "customer_events",
          })
        ).toBe("main.analytics.customer_events");
      });
    });

    describe("vertica", () => {
      it("should handle basic table path", () => {
        expect(
          getPath("vertica", {
            catalog: "catalog",
            schema: "schema",
            tableName: "table",
          })
        ).toBe("catalog.schema.table");
      });

      it("should handle Vertica naming conventions", () => {
        expect(
          getPath("vertica", {
            catalog: "mydb",
            schema: "public",
            tableName: "fact_sales",
          })
        ).toBe("mydb.public.fact_sales");
      });
    });

    // Edge cases and special scenarios
    describe("edge cases", () => {
      it("should handle empty catalog (MySQL case)", () => {
        expect(
          getPath("mysql", {
            catalog: "",
            schema: "schema",
            tableName: "table",
          })
        ).toBe("`schema`.`table`");
      });

      it("should handle special characters in BigQuery", () => {
        expect(
          getPath("bigquery", {
            catalog: "project-123",
            schema: "dataset_name",
            tableName: "table-name",
          })
        ).toBe("`project-123.dataset_name.table-name`");
      });

      it("should handle special characters in MySQL backticks", () => {
        expect(
          getPath("mysql", {
            catalog: "db-name",
            schema: "schema-name",
            tableName: "table-name",
          })
        ).toBe("`schema-name`.`table-name`");
      });
    });
  });
});
