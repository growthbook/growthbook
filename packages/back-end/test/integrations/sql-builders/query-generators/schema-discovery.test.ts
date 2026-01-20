/**
 * Tests for Schema Discovery Query Generator
 *
 * Tests the extraction of information schema query generation from SqlIntegration.
 */

import {
  generateInformationSchemaQuery,
  generateTableDataQuery,
  generateTablePath,
  defaultInformationSchemaConfigs,
  InformationSchemaConfig,
} from "../../../../src/integrations/sql-builders/query-generators/schema-discovery";

describe("Schema Discovery Query Generator", () => {
  describe("generateInformationSchemaQuery", () => {
    const standardConfig: InformationSchemaConfig = {
      tablePath: "information_schema.columns",
      whereClause: "table_schema NOT IN ('information_schema')",
      formatDialect: "",
    };

    it("should generate a valid information schema query", () => {
      const query = generateInformationSchemaQuery(standardConfig);

      // Check for expected columns
      expect(query).toContain("table_name as table_name");
      expect(query).toContain("table_catalog as table_catalog");
      expect(query).toContain("table_schema as table_schema");
      expect(query).toContain("count(column_name) as column_count");

      // Check for table source
      expect(query).toContain("information_schema.columns");

      // Check for WHERE clause
      expect(query).toContain("table_schema NOT IN ('information_schema')");

      // Check for GROUP BY
      expect(query).toContain("GROUP BY");
      expect(query).toContain("table_name");
      expect(query).toContain("table_schema");
      expect(query).toContain("table_catalog");
    });

    it("should handle fixed catalog (like Vertica)", () => {
      const verticaConfig: InformationSchemaConfig = {
        ...standardConfig,
        tablePath: "v_catalog.columns",
        fixedCatalog: "my_database",
      };

      const query = generateInformationSchemaQuery(verticaConfig);

      // Should use the fixed catalog value
      expect(query).toContain("'my_database' as table_catalog");

      // Should group by the literal value
      expect(query).toContain("'my_database'");
    });

    it("should use the correct table path for BigQuery", () => {
      const bigqueryConfig: InformationSchemaConfig = {
        tablePath: "my_dataset.INFORMATION_SCHEMA.COLUMNS",
        whereClause: "table_schema NOT IN ('information_schema')",
        formatDialect: "bigquery",
      };

      const query = generateInformationSchemaQuery(bigqueryConfig);

      expect(query).toContain("my_dataset.INFORMATION_SCHEMA.COLUMNS");
    });

    it("should use the correct table path for Redshift", () => {
      const redshiftConfig: InformationSchemaConfig = {
        tablePath: "SVV_COLUMNS",
        whereClause: "table_schema NOT IN ('information_schema')",
        formatDialect: "postgresql",
      };

      const query = generateInformationSchemaQuery(redshiftConfig);

      expect(query).toContain("SVV_COLUMNS");
    });

    it("should apply format dialect correctly", () => {
      const postgresConfig: InformationSchemaConfig = {
        ...standardConfig,
        formatDialect: "postgresql",
      };

      const query = generateInformationSchemaQuery(postgresConfig);

      // Query should be formatted
      expect(query).toContain("SELECT");
      expect(query).toContain("FROM");
      expect(query).toContain("WHERE");
    });
  });

  describe("generateTableDataQuery", () => {
    const standardConfig: InformationSchemaConfig = {
      tablePath: "information_schema.columns",
      whereClause: "",
      formatDialect: "",
    };

    it("should generate a valid table data query", () => {
      const query = generateTableDataQuery(standardConfig, {
        databaseName: "my_database",
        tableSchema: "public",
        tableName: "users",
      });

      // Check for expected columns
      expect(query).toContain("data_type as data_type");
      expect(query).toContain("column_name as column_name");

      // Check for table source
      expect(query).toContain("information_schema.columns");

      // Check for WHERE conditions
      expect(query).toContain("table_name = 'users'");
      expect(query).toContain("table_schema = 'public'");
      expect(query).toContain("table_catalog = 'my_database'");
    });

    it("should escape single quotes in identifiers", () => {
      const query = generateTableDataQuery(standardConfig, {
        databaseName: "my_db's",
        tableSchema: "schema'test",
        tableName: "table's_name",
      });

      // Single quotes should be escaped
      expect(query).toContain("my_db''s");
      expect(query).toContain("schema''test");
      expect(query).toContain("table''s_name");
    });

    it("should use the provided table path", () => {
      const redshiftConfig: InformationSchemaConfig = {
        tablePath: "SVV_COLUMNS",
        whereClause: "",
        formatDialect: "",
      };

      const query = generateTableDataQuery(redshiftConfig, {
        databaseName: "db",
        tableSchema: "public",
        tableName: "users",
      });

      expect(query).toContain("SVV_COLUMNS");
    });
  });

  describe("generateTablePath", () => {
    it("should return just the table name with no options", () => {
      const path = generateTablePath("my_table");
      expect(path).toBe("my_table");
    });

    it("should add database prefix when required", () => {
      const path = generateTablePath("my_table", {
        database: "my_db",
        requiresDatabase: true,
      });
      expect(path).toBe("my_db.my_table");
    });

    it("should add schema prefix when required", () => {
      const path = generateTablePath("my_table", {
        schema: "my_schema",
        requiresSchema: true,
      });
      expect(path).toBe("my_schema.my_table");
    });

    it("should add both database and schema prefixes", () => {
      const path = generateTablePath("my_table", {
        database: "my_db",
        schema: "my_schema",
        requiresDatabase: true,
        requiresSchema: true,
      });
      expect(path).toBe("my_db.my_schema.my_table");
    });

    it("should not add prefix if not required", () => {
      const path = generateTablePath("my_table", {
        database: "my_db",
        schema: "my_schema",
        requiresDatabase: false,
        requiresSchema: false,
      });
      expect(path).toBe("my_table");
    });

    it("should add escape characters when specified", () => {
      const path = generateTablePath("my_table", {
        database: "my_db",
        requiresDatabase: true,
        escapeChar: "`",
      });
      expect(path).toBe("`my_db.my_table`");
    });

    it("should handle complex table names with dots", () => {
      const path = generateTablePath("information_schema.columns");
      expect(path).toBe("information_schema.columns");
    });
  });

  describe("defaultInformationSchemaConfigs", () => {
    it("should have standard config", () => {
      expect(defaultInformationSchemaConfigs.standard.tablePath).toBe(
        "information_schema.columns"
      );
    });

    it("should have bigquery config", () => {
      expect(defaultInformationSchemaConfigs.bigquery.tablePath).toBe(
        "INFORMATION_SCHEMA.COLUMNS"
      );
    });

    it("should have redshift config with SVV_COLUMNS", () => {
      expect(defaultInformationSchemaConfigs.redshift.tablePath).toBe(
        "SVV_COLUMNS"
      );
    });

    it("should have vertica config with v_catalog.columns", () => {
      expect(defaultInformationSchemaConfigs.vertica.tablePath).toBe(
        "v_catalog.columns"
      );
      expect(defaultInformationSchemaConfigs.vertica.whereClause).toContain(
        "v_catalog"
      );
      expect(defaultInformationSchemaConfigs.vertica.whereClause).toContain(
        "NOT is_system_table"
      );
    });

    it("should have mysql config", () => {
      expect(defaultInformationSchemaConfigs.mysql.whereClause).toContain(
        "mysql"
      );
      expect(defaultInformationSchemaConfigs.mysql.whereClause).toContain(
        "performance_schema"
      );
    });

    it("should have postgres config", () => {
      expect(defaultInformationSchemaConfigs.postgres.whereClause).toContain(
        "pg_catalog"
      );
    });

    it("should have snowflake config", () => {
      expect(defaultInformationSchemaConfigs.snowflake.whereClause).toContain(
        "INFORMATION_SCHEMA"
      );
    });

    it("should have clickhouse config with system.columns", () => {
      expect(defaultInformationSchemaConfigs.clickhouse.tablePath).toBe(
        "system.columns"
      );
    });
  });

  describe("Query formatting", () => {
    it("should produce formatted SQL", () => {
      const config: InformationSchemaConfig = {
        tablePath: "information_schema.columns",
        whereClause: "table_schema NOT IN ('information_schema')",
        formatDialect: "",
      };

      const query = generateInformationSchemaQuery(config);

      // Check that query is formatted with proper structure
      expect(query).toMatch(/SELECT/);
      expect(query).toMatch(/FROM/);
      expect(query).toMatch(/WHERE/);
      expect(query).toMatch(/GROUP BY/);
    });
  });
});
