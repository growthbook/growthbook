import { formatInformationSchema } from "../../src/util/integrations";

describe("formatInformationSchema", () => {
  it("Correctly formats a rawInformationSchema for BigQuery correctly", () => {
    const rawInformationSchema = [
      {
        table_catalog: "adept-arbor-354914",
        table_name: "experiment-assignments",
        column_name: "TIMESTAMP",
        data_type: "TIMESTAMP",
        table_schema: "a_second_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "experiment-assignments",
        column_name: "variation",
        data_type: "INT64",
        table_schema: "a_second_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "experiment-assignments",
        column_name: "USERID",
        data_type: "STRING",
        table_schema: "a_second_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "orders",
        column_name: "TIMESTAMP",
        data_type: "TIMESTAMP",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "orders",
        column_name: "AMOUNT",
        data_type: "FLOAT64",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "orders",
        column_name: "USERID",
        data_type: "STRING",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "page-visitors",
        column_name: "USERID",
        data_type: "STRING",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "page-visitors",
        column_name: "TIMESTAMP",
        data_type: "TIMESTAMP",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "page-visitors",
        column_name: "BROWSER",
        data_type: "STRING",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "sample_table",
        column_name: "Day",
        data_type: "DATE",
        table_schema: "sample_data",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "sample_table",
        column_name: "Top_Term",
        data_type: "STRING",
        table_schema: "sample_data",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "sample_table",
        column_name: "rank",
        data_type: "INT64",
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
                columns: [
                  {
                    columnName: "timestamp",
                    dataType: "timestamp",
                    path:
                      "`adept-arbor-354914.a_second_data_set.experiment-assignments.timestamp`",
                  },
                  {
                    columnName: "variation",
                    dataType: "int64",
                    path:
                      "`adept-arbor-354914.a_second_data_set.experiment-assignments.variation`",
                  },
                  {
                    columnName: "userid",
                    dataType: "string",
                    path:
                      "`adept-arbor-354914.a_second_data_set.experiment-assignments.userid`",
                  },
                ],
                path:
                  "`adept-arbor-354914.a_second_data_set.experiment-assignments`",
                tableName: "experiment-assignments",
              },
            ],
          },
          {
            path: "`adept-arbor-354914.sample_data_set`",
            schemaName: "sample_data_set",
            tables: [
              {
                columns: [
                  {
                    columnName: "timestamp",
                    dataType: "timestamp",
                    path:
                      "`adept-arbor-354914.sample_data_set.orders.timestamp`",
                  },
                  {
                    columnName: "amount",
                    dataType: "float64",
                    path: "`adept-arbor-354914.sample_data_set.orders.amount`",
                  },
                  {
                    columnName: "userid",
                    dataType: "string",
                    path: "`adept-arbor-354914.sample_data_set.orders.userid`",
                  },
                ],
                path: "`adept-arbor-354914.sample_data_set.orders`",
                tableName: "orders",
              },
              {
                columns: [
                  {
                    columnName: "userid",
                    dataType: "string",
                    path:
                      "`adept-arbor-354914.sample_data_set.page-visitors.userid`",
                  },
                  {
                    columnName: "timestamp",
                    dataType: "timestamp",
                    path:
                      "`adept-arbor-354914.sample_data_set.page-visitors.timestamp`",
                  },
                  {
                    columnName: "browser",
                    dataType: "string",
                    path:
                      "`adept-arbor-354914.sample_data_set.page-visitors.browser`",
                  },
                ],
                path: "`adept-arbor-354914.sample_data_set.page-visitors`",
                tableName: "page-visitors",
              },
            ],
          },
          {
            path: "`adept-arbor-354914.sample_data`",
            schemaName: "sample_data",
            tables: [
              {
                columns: [
                  {
                    columnName: "day",
                    dataType: "date",
                    path: "`adept-arbor-354914.sample_data.sample_table.day`",
                  },
                  {
                    columnName: "top_term",
                    dataType: "string",
                    path:
                      "`adept-arbor-354914.sample_data.sample_table.top_term`",
                  },
                  {
                    columnName: "rank",
                    dataType: "int64",
                    path: "`adept-arbor-354914.sample_data.sample_table.rank`",
                  },
                ],
                path: "`adept-arbor-354914.sample_data.sample_table`",
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
        column_name: "TIMESTAMP",
        data_type: "TIMESTAMP",
        table_schema: "a_second_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "experiment-assignments",
        column_name: "variation",
        data_type: "INT64",
        table_schema: "a_second_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "experiment-assignments",
        column_name: "USERID",
        data_type: "STRING",
        table_schema: "a_second_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "orders",
        column_name: "TIMESTAMP",
        data_type: "TIMESTAMP",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "orders",
        column_name: "AMOUNT",
        data_type: "FLOAT64",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "orders",
        column_name: "USERID",
        data_type: "STRING",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "page-visitors",
        column_name: "USERID",
        data_type: "STRING",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "page-visitors",
        column_name: "TIMESTAMP",
        data_type: "TIMESTAMP",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "page-visitors",
        column_name: "BROWSER",
        data_type: "STRING",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "sample_table",
        column_name: "Day",
        data_type: "DATE",
        table_schema: "sample_data",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "sample_table",
        column_name: "Top_Term",
        data_type: "STRING",
        table_schema: "sample_data",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "sample_table",
        column_name: "rank",
        data_type: "INT64",
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
                columns: [
                  {
                    columnName: "timestamp",
                    dataType: "timestamp",
                    path:
                      "adept-arbor-354914.a_second_data_set.experiment-assignments.timestamp",
                  },
                  {
                    columnName: "variation",
                    dataType: "int64",
                    path:
                      "adept-arbor-354914.a_second_data_set.experiment-assignments.variation",
                  },
                  {
                    columnName: "userid",
                    dataType: "string",
                    path:
                      "adept-arbor-354914.a_second_data_set.experiment-assignments.userid",
                  },
                ],
                path:
                  "adept-arbor-354914.a_second_data_set.experiment-assignments",
                tableName: "experiment-assignments",
              },
            ],
          },
          {
            path: "adept-arbor-354914.sample_data_set",
            schemaName: "sample_data_set",
            tables: [
              {
                columns: [
                  {
                    columnName: "timestamp",
                    dataType: "timestamp",
                    path: "adept-arbor-354914.sample_data_set.orders.timestamp",
                  },
                  {
                    columnName: "amount",
                    dataType: "float64",
                    path: "adept-arbor-354914.sample_data_set.orders.amount",
                  },
                  {
                    columnName: "userid",
                    dataType: "string",
                    path: "adept-arbor-354914.sample_data_set.orders.userid",
                  },
                ],
                path: "adept-arbor-354914.sample_data_set.orders",
                tableName: "orders",
              },
              {
                columns: [
                  {
                    columnName: "userid",
                    dataType: "string",
                    path:
                      "adept-arbor-354914.sample_data_set.page-visitors.userid",
                  },
                  {
                    columnName: "timestamp",
                    dataType: "timestamp",
                    path:
                      "adept-arbor-354914.sample_data_set.page-visitors.timestamp",
                  },
                  {
                    columnName: "browser",
                    dataType: "string",
                    path:
                      "adept-arbor-354914.sample_data_set.page-visitors.browser",
                  },
                ],
                path: "adept-arbor-354914.sample_data_set.page-visitors",
                tableName: "page-visitors",
              },
            ],
          },
          {
            path: "adept-arbor-354914.sample_data",
            schemaName: "sample_data",
            tables: [
              {
                columns: [
                  {
                    columnName: "day",
                    dataType: "date",
                    path: "adept-arbor-354914.sample_data.sample_table.day",
                  },
                  {
                    columnName: "top_term",
                    dataType: "string",
                    path:
                      "adept-arbor-354914.sample_data.sample_table.top_term",
                  },
                  {
                    columnName: "rank",
                    dataType: "int64",
                    path: "adept-arbor-354914.sample_data.sample_table.rank",
                  },
                ],
                path: "adept-arbor-354914.sample_data.sample_table",
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
        column_name: "TIMESTAMP",
        data_type: "TIMESTAMP",
        table_schema: "a_second_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "experiment-assignments",
        column_name: "variation",
        data_type: "INT64",
        table_schema: "a_second_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "experiment-assignments",
        column_name: "USERID",
        data_type: "STRING",
        table_schema: "a_second_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "orders",
        column_name: "TIMESTAMP",
        data_type: "TIMESTAMP",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "orders",
        column_name: "AMOUNT",
        data_type: "FLOAT64",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "orders",
        column_name: "USERID",
        data_type: "STRING",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "page-visitors",
        column_name: "USERID",
        data_type: "STRING",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "page-visitors",
        column_name: "TIMESTAMP",
        data_type: "TIMESTAMP",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "page-visitors",
        column_name: "BROWSER",
        data_type: "STRING",
        table_schema: "sample_data_set",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "sample_table",
        column_name: "Day",
        data_type: "DATE",
        table_schema: "sample_data",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "sample_table",
        column_name: "Top_Term",
        data_type: "STRING",
        table_schema: "sample_data",
      },
      {
        table_catalog: "adept-arbor-354914",
        table_name: "sample_table",
        column_name: "rank",
        data_type: "INT64",
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
                columns: [
                  {
                    columnName: "timestamp",
                    dataType: "timestamp",
                    path: "a_second_data_set.experiment-assignments.timestamp",
                  },
                  {
                    columnName: "variation",
                    dataType: "int64",
                    path: "a_second_data_set.experiment-assignments.variation",
                  },
                  {
                    columnName: "userid",
                    dataType: "string",
                    path: "a_second_data_set.experiment-assignments.userid",
                  },
                ],
                path: "a_second_data_set.experiment-assignments",
                tableName: "experiment-assignments",
              },
            ],
          },
          {
            path: "sample_data_set",
            schemaName: "sample_data_set",
            tables: [
              {
                columns: [
                  {
                    columnName: "timestamp",
                    dataType: "timestamp",
                    path: "sample_data_set.orders.timestamp",
                  },
                  {
                    columnName: "amount",
                    dataType: "float64",
                    path: "sample_data_set.orders.amount",
                  },
                  {
                    columnName: "userid",
                    dataType: "string",
                    path: "sample_data_set.orders.userid",
                  },
                ],
                path: "sample_data_set.orders",
                tableName: "orders",
              },
              {
                columns: [
                  {
                    columnName: "userid",
                    dataType: "string",
                    path: "sample_data_set.page-visitors.userid",
                  },
                  {
                    columnName: "timestamp",
                    dataType: "timestamp",
                    path: "sample_data_set.page-visitors.timestamp",
                  },
                  {
                    columnName: "browser",
                    dataType: "string",
                    path: "sample_data_set.page-visitors.browser",
                  },
                ],
                path: "sample_data_set.page-visitors",
                tableName: "page-visitors",
              },
            ],
          },
          {
            path: "sample_data",
            schemaName: "sample_data",
            tables: [
              {
                columns: [
                  {
                    columnName: "day",
                    dataType: "date",
                    path: "sample_data.sample_table.day",
                  },
                  {
                    columnName: "top_term",
                    dataType: "string",
                    path: "sample_data.sample_table.top_term",
                  },
                  {
                    columnName: "rank",
                    dataType: "int64",
                    path: "sample_data.sample_table.rank",
                  },
                ],
                path: "sample_data.sample_table",
                tableName: "sample_table",
              },
            ],
          },
        ],
      },
    ]);
  });
});
