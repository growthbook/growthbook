import { getTablePath } from "back-end/src/services/informationSchema";

describe("schema service", () => {
  describe("getTablePath", () => {
    const mockParams = {
      catalog: "my_catalog",
      schema: "my_schema",
      tableName: "my_table",
    };

    describe("mysql", () => {
      it("should generate MySQL table path with backticks", () => {
        const result = getTablePath("mysql", mockParams);
        expect(result).toBe("`my_schema`.`my_table`");
      });

      it("should handle reserved words safely", () => {
        const result = getTablePath("mysql", {
          catalog: "database",
          schema: "order",
          tableName: "select",
        });
        expect(result).toBe("`order`.`select`");
      });
    });

    describe("clickhouse", () => {
      it("should generate ClickHouse table path with backticks", () => {
        const result = getTablePath("clickhouse", mockParams);
        expect(result).toBe("`my_schema`.`my_table`");
      });

      it("should handle special characters", () => {
        const result = getTablePath("clickhouse", {
          catalog: "catalog",
          schema: "my-schema",
          tableName: "my_table_name",
        });
        expect(result).toBe("`my-schema`.`my_table_name`");
      });
    });

    describe("bigquery", () => {
      it("should generate BigQuery table path with full backticks", () => {
        const result = getTablePath("bigquery", mockParams);
        expect(result).toBe("`my_catalog.my_schema.my_table`");
      });

      it("should handle project names with dashes", () => {
        const result = getTablePath("bigquery", {
          catalog: "project-123",
          schema: "dataset_name",
          tableName: "table-name",
        });
        expect(result).toBe("`project-123.dataset_name.table-name`");
      });
    });

    describe("growthbook_clickhouse", () => {
      it("should return only table name", () => {
        const result = getTablePath("growthbook_clickhouse", mockParams);
        expect(result).toBe("my_table");
      });

      it("should handle complex table names", () => {
        const result = getTablePath("growthbook_clickhouse", {
          catalog: "catalog",
          schema: "schema",
          tableName: "user_events_daily",
        });
        expect(result).toBe("user_events_daily");
      });
    });

    describe("postgres", () => {
      it("should generate standard Postgres table path", () => {
        const result = getTablePath("postgres", mockParams);
        expect(result).toBe("my_catalog.my_schema.my_table");
      });

      it("should handle public schema", () => {
        const result = getTablePath("postgres", {
          catalog: "mydb",
          schema: "public",
          tableName: "users",
        });
        expect(result).toBe("mydb.public.users");
      });
    });

    describe("snowflake", () => {
      it("should generate standard Snowflake table path", () => {
        const result = getTablePath("snowflake", mockParams);
        expect(result).toBe("my_catalog.my_schema.my_table");
      });

      it("should handle uppercase naming", () => {
        const result = getTablePath("snowflake", {
          catalog: "PROD_DB",
          schema: "ANALYTICS",
          tableName: "USER_EVENTS",
        });
        expect(result).toBe("PROD_DB.ANALYTICS.USER_EVENTS");
      });
    });

    describe("default datasources", () => {
      it("should use default format for redshift", () => {
        const result = getTablePath("redshift", mockParams);
        expect(result).toBe("my_catalog.my_schema.my_table");
      });

      it("should use default format for athena", () => {
        const result = getTablePath("athena", mockParams);
        expect(result).toBe("my_catalog.my_schema.my_table");
      });

      it("should use default format for mssql", () => {
        const result = getTablePath("mssql", mockParams);
        expect(result).toBe("my_catalog.my_schema.my_table");
      });

      it("should use default format for presto", () => {
        const result = getTablePath("presto", mockParams);
        expect(result).toBe("my_catalog.my_schema.my_table");
      });

      it("should use default format for databricks", () => {
        const result = getTablePath("databricks", mockParams);
        expect(result).toBe("my_catalog.my_schema.my_table");
      });

      it("should use default format for vertica", () => {
        const result = getTablePath("vertica", mockParams);
        expect(result).toBe("my_catalog.my_schema.my_table");
      });
    });
  });
});
