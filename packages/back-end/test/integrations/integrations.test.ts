import { RawInformationSchema } from "../../src/types/Integration";
import { formatInformationSchema } from "../../src/util/integrations";

describe("formatInformationSchema", () => {
  it("Correctly formats a rawInformationSchema for BigQuery correctly", () => {
    const rawInformationSchema: RawInformationSchema[] = [
      {
        table_catalog: "adept-arbor-354914",
        table_name: "experiment-assignments",
        table_schema: "a_second_data_set",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "experiment-assignments",
        table_schema: "a_second_data_set",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "experiment-assignments",
        table_schema: "a_second_data_set",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "orders",
        table_schema: "sample_data_set",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "orders",
        table_schema: "sample_data_set",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "orders",
        table_schema: "sample_data_set",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "page-visitors",
        table_schema: "sample_data_set",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "page-visitors",
        table_schema: "sample_data_set",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "page-visitors",
        table_schema: "sample_data_set",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "sample_table",
        table_schema: "sample_data",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "sample_table",
        table_schema: "sample_data",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "sample_table",
        table_schema: "sample_data",
        column_count: "3",
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
                path:
                  "`adept-arbor-354914.a_second_data_set.experiment-assignments`",
                id: "",
                numOfColumns: 3,
                tableName: "experiment-assignments",
              },
            ],
          },
          {
            path: "`adept-arbor-354914.sample_data_set`",
            schemaName: "sample_data_set",
            tables: [
              {
                path: "`adept-arbor-354914.sample_data_set.orders`",
                id: "",
                numOfColumns: 3,
                tableName: "orders",
              },
              {
                path: "`adept-arbor-354914.sample_data_set.page-visitors`",
                id: "",
                numOfColumns: 3,
                tableName: "page-visitors",
              },
            ],
          },
          {
            path: "`adept-arbor-354914.sample_data`",
            schemaName: "sample_data",
            tables: [
              {
                path: "`adept-arbor-354914.sample_data.sample_table`",
                id: "",
                numOfColumns: 3,
                tableName: "sample_table",
              },
            ],
          },
        ],
      },
    ]);
  });

  it("Correctly formats a rawInformationSchema for Postgres correctly", () => {
    const rawInformationSchema: RawInformationSchema[] = [
      {
        table_catalog: "adept-arbor-354914",
        table_name: "experiment-assignments",
        table_schema: "a_second_data_set",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "experiment-assignments",
        table_schema: "a_second_data_set",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "experiment-assignments",
        table_schema: "a_second_data_set",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "orders",
        table_schema: "sample_data_set",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "orders",
        table_schema: "sample_data_set",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "orders",
        table_schema: "sample_data_set",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "page-visitors",
        table_schema: "sample_data_set",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "page-visitors",
        table_schema: "sample_data_set",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "page-visitors",
        table_schema: "sample_data_set",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "sample_table",
        table_schema: "sample_data",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "sample_table",
        table_schema: "sample_data",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "sample_table",
        table_schema: "sample_data",
        column_count: "3",
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
                path:
                  "adept-arbor-354914.a_second_data_set.experiment-assignments",
                id: "",
                numOfColumns: 3,
                tableName: "experiment-assignments",
              },
            ],
          },
          {
            path: "adept-arbor-354914.sample_data_set",
            schemaName: "sample_data_set",
            tables: [
              {
                path: "adept-arbor-354914.sample_data_set.orders",
                id: "",
                numOfColumns: 3,
                tableName: "orders",
              },
              {
                path: "adept-arbor-354914.sample_data_set.page-visitors",
                id: "",
                numOfColumns: 3,
                tableName: "page-visitors",
              },
            ],
          },
          {
            path: "adept-arbor-354914.sample_data",
            schemaName: "sample_data",
            tables: [
              {
                path: "adept-arbor-354914.sample_data.sample_table",
                id: "",
                numOfColumns: 3,
                tableName: "sample_table",
              },
            ],
          },
        ],
      },
    ]);
  });

  it("Correctly formats a rawInformationSchema for MySQL correctly", () => {
    const rawInformationSchema: RawInformationSchema[] = [
      {
        table_catalog: "adept-arbor-354914",
        table_name: "experiment-assignments",
        table_schema: "a_second_data_set",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "experiment-assignments",
        table_schema: "a_second_data_set",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "experiment-assignments",
        table_schema: "a_second_data_set",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "orders",
        table_schema: "sample_data_set",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "orders",
        table_schema: "sample_data_set",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "orders",
        table_schema: "sample_data_set",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "page-visitors",
        table_schema: "sample_data_set",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "page-visitors",
        table_schema: "sample_data_set",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "page-visitors",
        table_schema: "sample_data_set",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "sample_table",
        table_schema: "sample_data",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "sample_table",
        table_schema: "sample_data",
        column_count: "3",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "sample_table",
        table_schema: "sample_data",
        column_count: "3",
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
                path: "a_second_data_set.experiment-assignments",
                id: "",
                numOfColumns: 3,
                tableName: "experiment-assignments",
              },
            ],
          },
          {
            path: "sample_data_set",
            schemaName: "sample_data_set",
            tables: [
              {
                path: "sample_data_set.orders",
                id: "",
                numOfColumns: 3,
                tableName: "orders",
              },
              {
                path: "sample_data_set.page-visitors",
                id: "",
                numOfColumns: 3,
                tableName: "page-visitors",
              },
            ],
          },
          {
            path: "sample_data",
            schemaName: "sample_data",
            tables: [
              {
                path: "sample_data.sample_table",
                id: "",
                numOfColumns: 3,
                tableName: "sample_table",
              },
            ],
          },
        ],
      },
    ]);
  });
});
