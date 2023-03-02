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
        database_name: "adept-arbor-354914",
        path: "`adept-arbor-354914`",
        schemas: [
          {
            path: "`adept-arbor-354914.a_second_data_set`",
            schema_name: "a_second_data_set",
            tables: [
              {
                columns: [
                  {
                    column_name: "TIMESTAMP",
                    data_type: "TIMESTAMP",
                    path:
                      "`adept-arbor-354914.a_second_data_set.experiment-assignments.TIMESTAMP`",
                  },
                  {
                    column_name: "variation",
                    data_type: "INT64",
                    path:
                      "`adept-arbor-354914.a_second_data_set.experiment-assignments.variation`",
                  },
                  {
                    column_name: "USERID",
                    data_type: "STRING",
                    path:
                      "`adept-arbor-354914.a_second_data_set.experiment-assignments.USERID`",
                  },
                ],
                path:
                  "`adept-arbor-354914.a_second_data_set.experiment-assignments`",
                table_name: "experiment-assignments",
              },
            ],
          },
          {
            path: "`adept-arbor-354914.sample_data_set`",
            schema_name: "sample_data_set",
            tables: [
              {
                columns: [
                  {
                    column_name: "TIMESTAMP",
                    data_type: "TIMESTAMP",
                    path:
                      "`adept-arbor-354914.sample_data_set.orders.TIMESTAMP`",
                  },
                  {
                    column_name: "AMOUNT",
                    data_type: "FLOAT64",
                    path: "`adept-arbor-354914.sample_data_set.orders.AMOUNT`",
                  },
                  {
                    column_name: "USERID",
                    data_type: "STRING",
                    path: "`adept-arbor-354914.sample_data_set.orders.USERID`",
                  },
                ],
                path: "`adept-arbor-354914.sample_data_set.orders`",
                table_name: "orders",
              },
              {
                columns: [
                  {
                    column_name: "USERID",
                    data_type: "STRING",
                    path:
                      "`adept-arbor-354914.sample_data_set.page-visitors.USERID`",
                  },
                  {
                    column_name: "TIMESTAMP",
                    data_type: "TIMESTAMP",
                    path:
                      "`adept-arbor-354914.sample_data_set.page-visitors.TIMESTAMP`",
                  },
                  {
                    column_name: "BROWSER",
                    data_type: "STRING",
                    path:
                      "`adept-arbor-354914.sample_data_set.page-visitors.BROWSER`",
                  },
                ],
                path: "`adept-arbor-354914.sample_data_set.page-visitors`",
                table_name: "page-visitors",
              },
            ],
          },
          {
            path: "`adept-arbor-354914.sample_data`",
            schema_name: "sample_data",
            tables: [
              {
                columns: [
                  {
                    column_name: "Day",
                    data_type: "DATE",
                    path: "`adept-arbor-354914.sample_data.sample_table.Day`",
                  },
                  {
                    column_name: "Top_Term",
                    data_type: "STRING",
                    path:
                      "`adept-arbor-354914.sample_data.sample_table.Top_Term`",
                  },
                  {
                    column_name: "rank",
                    data_type: "INT64",
                    path: "`adept-arbor-354914.sample_data.sample_table.rank`",
                  },
                ],
                path: "`adept-arbor-354914.sample_data.sample_table`",
                table_name: "sample_table",
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
        database_name: "adept-arbor-354914",
        path: "adept-arbor-354914",
        schemas: [
          {
            path: "adept-arbor-354914.a_second_data_set",
            schema_name: "a_second_data_set",
            tables: [
              {
                columns: [
                  {
                    column_name: "TIMESTAMP",
                    data_type: "TIMESTAMP",
                    path:
                      "adept-arbor-354914.a_second_data_set.experiment-assignments.TIMESTAMP",
                  },
                  {
                    column_name: "variation",
                    data_type: "INT64",
                    path:
                      "adept-arbor-354914.a_second_data_set.experiment-assignments.variation",
                  },
                  {
                    column_name: "USERID",
                    data_type: "STRING",
                    path:
                      "adept-arbor-354914.a_second_data_set.experiment-assignments.USERID",
                  },
                ],
                path:
                  "adept-arbor-354914.a_second_data_set.experiment-assignments",
                table_name: "experiment-assignments",
              },
            ],
          },
          {
            path: "adept-arbor-354914.sample_data_set",
            schema_name: "sample_data_set",
            tables: [
              {
                columns: [
                  {
                    column_name: "TIMESTAMP",
                    data_type: "TIMESTAMP",
                    path: "adept-arbor-354914.sample_data_set.orders.TIMESTAMP",
                  },
                  {
                    column_name: "AMOUNT",
                    data_type: "FLOAT64",
                    path: "adept-arbor-354914.sample_data_set.orders.AMOUNT",
                  },
                  {
                    column_name: "USERID",
                    data_type: "STRING",
                    path: "adept-arbor-354914.sample_data_set.orders.USERID",
                  },
                ],
                path: "adept-arbor-354914.sample_data_set.orders",
                table_name: "orders",
              },
              {
                columns: [
                  {
                    column_name: "USERID",
                    data_type: "STRING",
                    path:
                      "adept-arbor-354914.sample_data_set.page-visitors.USERID",
                  },
                  {
                    column_name: "TIMESTAMP",
                    data_type: "TIMESTAMP",
                    path:
                      "adept-arbor-354914.sample_data_set.page-visitors.TIMESTAMP",
                  },
                  {
                    column_name: "BROWSER",
                    data_type: "STRING",
                    path:
                      "adept-arbor-354914.sample_data_set.page-visitors.BROWSER",
                  },
                ],
                path: "adept-arbor-354914.sample_data_set.page-visitors",
                table_name: "page-visitors",
              },
            ],
          },
          {
            path: "adept-arbor-354914.sample_data",
            schema_name: "sample_data",
            tables: [
              {
                columns: [
                  {
                    column_name: "Day",
                    data_type: "DATE",
                    path: "adept-arbor-354914.sample_data.sample_table.Day",
                  },
                  {
                    column_name: "Top_Term",
                    data_type: "STRING",
                    path:
                      "adept-arbor-354914.sample_data.sample_table.Top_Term",
                  },
                  {
                    column_name: "rank",
                    data_type: "INT64",
                    path: "adept-arbor-354914.sample_data.sample_table.rank",
                  },
                ],
                path: "adept-arbor-354914.sample_data.sample_table",
                table_name: "sample_table",
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
        database_name: "adept-arbor-354914",
        path: "adept-arbor-354914",
        schemas: [
          {
            path: "adept-arbor-354914.a_second_data_set",
            schema_name: "a_second_data_set",
            tables: [
              {
                columns: [
                  {
                    column_name: "TIMESTAMP",
                    data_type: "TIMESTAMP",
                    path: "experiment-assignments.TIMESTAMP",
                  },
                  {
                    column_name: "variation",
                    data_type: "INT64",
                    path: "experiment-assignments.variation",
                  },
                  {
                    column_name: "USERID",
                    data_type: "STRING",
                    path: "experiment-assignments.USERID",
                  },
                ],
                path: "a_second_data_set.experiment-assignments",
                table_name: "experiment-assignments",
              },
            ],
          },
          {
            path: "adept-arbor-354914.sample_data_set",
            schema_name: "sample_data_set",
            tables: [
              {
                columns: [
                  {
                    column_name: "TIMESTAMP",
                    data_type: "TIMESTAMP",
                    path: "orders.TIMESTAMP",
                  },
                  {
                    column_name: "AMOUNT",
                    data_type: "FLOAT64",
                    path: "orders.AMOUNT",
                  },
                  {
                    column_name: "USERID",
                    data_type: "STRING",
                    path: "orders.USERID",
                  },
                ],
                path: "sample_data_set.orders",
                table_name: "orders",
              },
              {
                columns: [
                  {
                    column_name: "USERID",
                    data_type: "STRING",
                    path: "page-visitors.USERID",
                  },
                  {
                    column_name: "TIMESTAMP",
                    data_type: "TIMESTAMP",
                    path: "page-visitors.TIMESTAMP",
                  },
                  {
                    column_name: "BROWSER",
                    data_type: "STRING",
                    path: "page-visitors.BROWSER",
                  },
                ],
                path: "sample_data_set.page-visitors",
                table_name: "page-visitors",
              },
            ],
          },
          {
            path: "adept-arbor-354914.sample_data",
            schema_name: "sample_data",
            tables: [
              {
                columns: [
                  {
                    column_name: "Day",
                    data_type: "DATE",
                    path: "sample_table.Day",
                  },
                  {
                    column_name: "Top_Term",
                    data_type: "STRING",
                    path: "sample_table.Top_Term",
                  },
                  {
                    column_name: "rank",
                    data_type: "INT64",
                    path: "sample_table.rank",
                  },
                ],
                path: "sample_data.sample_table",
                table_name: "sample_table",
              },
            ],
          },
        ],
      },
    ]);
  });
});
