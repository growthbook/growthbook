import { formatInformationSchema } from "../../src/util/integrations";

describe("formatInformationSchema", () => {
  it("Correctly formats a rawInformationSchema for BigQuery correctly", () => {
    const rawInformationSchema = [
      {
        table_catalog: "adept-arbor-354914",
        table_name: "experiment-assignments",
        table_schema: "a_second_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "experiment-assignments",
        table_schema: "a_second_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "experiment-assignments",
        table_schema: "a_second_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "orders",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "orders",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "orders",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "page-visitors",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "page-visitors",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "page-visitors",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "sample_table",
        table_schema: "sample_data",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "sample_table",
        table_schema: "sample_data",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "sample_table",
        table_schema: "sample_data",
      },
    ];
    const formattedResults = formatInformationSchema(
      rawInformationSchema,
      "bigquery"
    );

    expect(formattedResults).toEqual([
      {
        databaseName: "adept-arbor-354914",
        path: "`adept-arbor-354914`",
        schemas: [
          {
            path: "`adept-arbor-354914.a_second_data_set`",
            schemaName: "a_second_data_set",
            tables: [
              {
                tableName: "experiment-assignments",
              },
            ],
          },
          {
            path: "`adept-arbor-354914.sample_data_set`",
            schemaName: "sample_data_set",
            tables: [
              {
                tableName: "orders",
              },
              {
                tableName: "page-visitors",
              },
            ],
          },
          {
            path: "`adept-arbor-354914.sample_data`",
            schemaName: "sample_data",
            tables: [
              {
                tableName: "sample_table",
              },
            ],
          },
        ],
      },
    ]);
  });

  it("Correctly formats a rawInformationSchema for Postgres correctly", () => {
    const rawInformationSchema = [
      {
        table_catalog: "adept-arbor-354914",
        table_name: "experiment-assignments",
        table_schema: "a_second_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "experiment-assignments",
        table_schema: "a_second_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "experiment-assignments",
        table_schema: "a_second_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "orders",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "orders",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "orders",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "page-visitors",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "page-visitors",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "page-visitors",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "sample_table",
        table_schema: "sample_data",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "sample_table",
        table_schema: "sample_data",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "sample_table",
        table_schema: "sample_data",
      },
    ];
    const formattedResults = formatInformationSchema(
      rawInformationSchema,
      "postgres"
    );

    expect(formattedResults).toEqual([
      {
        databaseName: "adept-arbor-354914",
        path: "adept-arbor-354914",
        schemas: [
          {
            path: "adept-arbor-354914.a_second_data_set",
            schemaName: "a_second_data_set",
            tables: [
              {
                tableName: "experiment-assignments",
              },
            ],
          },
          {
            path: "adept-arbor-354914.sample_data_set",
            schemaName: "sample_data_set",
            tables: [
              {
                tableName: "orders",
              },
              {
                tableName: "page-visitors",
              },
            ],
          },
          {
            path: "adept-arbor-354914.sample_data",
            schemaName: "sample_data",
            tables: [
              {
                tableName: "sample_table",
              },
            ],
          },
        ],
      },
    ]);
  });

  it("Correctly formats a rawInformationSchema for MySQL correctly", () => {
    const rawInformationSchema = [
      {
        table_catalog: "adept-arbor-354914",
        table_name: "experiment-assignments",
        table_schema: "a_second_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "experiment-assignments",
        table_schema: "a_second_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "experiment-assignments",
        table_schema: "a_second_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "orders",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "orders",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "orders",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "page-visitors",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "page-visitors",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "page-visitors",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "sample_table",
        table_schema: "sample_data",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "sample_table",
        table_schema: "sample_data",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "sample_table",
        table_schema: "sample_data",
      },
    ];
    const formattedResults = formatInformationSchema(
      rawInformationSchema,
      "mysql"
    );

    expect(formattedResults).toEqual([
      {
        databaseName: "adept-arbor-354914",
        path: "",
        schemas: [
          {
            path: "a_second_data_set",
            schemaName: "a_second_data_set",
            tables: [
              {
                tableName: "experiment-assignments",
              },
            ],
          },
          {
            path: "sample_data_set",
            schemaName: "sample_data_set",
            tables: [
              {
                tableName: "orders",
              },
              {
                tableName: "page-visitors",
              },
            ],
          },
          {
            path: "sample_data",
            schemaName: "sample_data",
            tables: [
              {
                tableName: "sample_table",
              },
            ],
          },
        ],
      },
    ]);
  });
});
