import {
  InformationSchema,
  RawInformationSchema,
} from "../../src/types/Integration";
import { formatInformationSchema } from "../../src/util/informationSchemas";
import {
  mergeStaleInformationSchemaWithUpdate,
  getRecentlyDeletedTables,
} from "../../src/services/informationSchema";

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
      "bigquery",
    );

    expect(formattedResults[0].databaseName).toEqual("adept-arbor-354914");
    expect(formattedResults[0].path).toEqual("`adept-arbor-354914`");
    expect(formattedResults[0].schemas[0].path).toEqual(
      "`adept-arbor-354914.a_second_data_set`",
    );
    expect(formattedResults[0].schemas[0].schemaName).toEqual(
      "a_second_data_set",
    );
    expect(formattedResults[0].schemas[0].tables[0].path).toEqual(
      "`adept-arbor-354914.a_second_data_set.experiment-assignments`",
    );
    expect(formattedResults[0].schemas[0].tables[0].numOfColumns).toEqual(3);
    expect(formattedResults[0].schemas[0].tables[0].tableName).toEqual(
      "experiment-assignments",
    );
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
      "postgres",
    );

    expect(formattedResults[0].databaseName).toEqual("adept-arbor-354914");
    expect(formattedResults[0].path).toEqual("adept-arbor-354914");
    expect(formattedResults[0].schemas[0].path).toEqual(
      "adept-arbor-354914.a_second_data_set",
    );
    expect(formattedResults[0].schemas[0].schemaName).toEqual(
      "a_second_data_set",
    );
    expect(formattedResults[0].schemas[0].tables[0].path).toEqual(
      "adept-arbor-354914.a_second_data_set.experiment-assignments",
    );
    expect(formattedResults[0].schemas[0].tables[0].numOfColumns).toEqual(3);
    expect(formattedResults[0].schemas[0].tables[0].tableName).toEqual(
      "experiment-assignments",
    );
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
      "mysql",
    );

    expect(formattedResults[0].databaseName).toEqual("adept-arbor-354914");
    expect(formattedResults[0].path).toEqual("");
    expect(formattedResults[0].schemas[0].path).toEqual("a_second_data_set");
    expect(formattedResults[0].schemas[0].schemaName).toEqual(
      "a_second_data_set",
    );
    expect(formattedResults[0].schemas[0].tables[0].path).toEqual(
      "a_second_data_set.experiment-assignments",
    );
    expect(formattedResults[0].schemas[0].tables[0].numOfColumns).toEqual(3);
    expect(formattedResults[0].schemas[0].tables[0].tableName).toEqual(
      "experiment-assignments",
    );
  });
});

describe("mergeStaleInformationSchemaWithUpdated", () => {
  it("Correctly updates the original informationSchema when a new table is added", async () => {
    const staleInformationSchema: InformationSchema[] = [
      {
        databaseName: "sample_database_name",
        path: "sample_org_id",
        schemas: [
          {
            schemaName: "sample_schema_name",
            path: "sample_org_id.sample_database_name",
            tables: [
              {
                tableName: "sample_table_name",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "sample_table_id-1",
                numOfColumns: 3,
                dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
                dateUpdated: new Date("2023-03-17T15:49:29.368+00:00"),
              },
              {
                tableName: "sample_table_name-with-no-id",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "",
                numOfColumns: 4,
                dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
                dateUpdated: new Date("2023-03-17T15:49:29.368+00:00"),
              },
              {
                tableName: "sample_table-3",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "sample_table_id-3",
                numOfColumns: 8,
                dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
                dateUpdated: new Date("2023-03-17T15:49:29.368+00:00"),
              },
            ],
            dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
            dateUpdated: new Date("2023-03-17T15:49:29.368+00:00"),
          },
        ],
        dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
        dateUpdated: new Date("2023-03-17T15:49:29.368+00:00"),
      },
    ];
    const updatedInformationSchema: InformationSchema[] = [
      {
        databaseName: "sample_database_name",
        path: "sample_org_id",
        schemas: [
          {
            schemaName: "sample_schema_name",
            path: "sample_org_id.sample_database_name",
            tables: [
              {
                tableName: "sample_table_name",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "",
                numOfColumns: 3,
                dateCreated: new Date("2023-03-18T15:00:00.000+00:00"),
                dateUpdated: new Date("2023-03-18T15:00:00.300+00:00"),
              },
              {
                tableName: "sample_table_name-with-no-id",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "",
                numOfColumns: 4,
                dateCreated: new Date("2023-03-18T15:00:00.000+00:00"),
                dateUpdated: new Date("2023-03-18T15:00:00.300+00:00"),
              },
              {
                tableName: "sample_table-3",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "",
                numOfColumns: 8,
                dateCreated: new Date("2023-03-18T15:00:00.000+00:00"),
                dateUpdated: new Date("2023-03-18T15:00:00.300+00:00"),
              },
              {
                tableName: "newly-added-table",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "",
                numOfColumns: 16,
                dateCreated: new Date("2023-03-18T15:00:00.000+00:00"),
                dateUpdated: new Date("2023-03-18T15:00:00.300+00:00"),
              },
            ],
            dateCreated: new Date("2023-03-18T15:00:00.000+00:00"),
            dateUpdated: new Date("2023-03-18T15:00:00.300+00:00"),
          },
        ],
        dateCreated: new Date("2023-03-18T15:00:00.000+00:00"),
        dateUpdated: new Date("2023-03-18T15:00:00.300+00:00"),
      },
    ];

    const mergedInformationSchema = await mergeStaleInformationSchemaWithUpdate(
      staleInformationSchema,
      updatedInformationSchema,
      "sample_org_id",
    );

    expect(mergedInformationSchema).toEqual([
      {
        databaseName: "sample_database_name",
        path: "sample_org_id",
        schemas: [
          {
            schemaName: "sample_schema_name",
            path: "sample_org_id.sample_database_name",
            tables: [
              {
                tableName: "sample_table_name",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "sample_table_id-1",
                numOfColumns: 3,
                dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
                dateUpdated: new Date("2023-03-17T15:49:29.368+00:00"),
              },
              {
                tableName: "sample_table_name-with-no-id",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "",
                numOfColumns: 4,
                dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
                dateUpdated: new Date("2023-03-17T15:49:29.368+00:00"),
              },
              {
                tableName: "sample_table-3",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "sample_table_id-3",
                numOfColumns: 8,
                dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
                dateUpdated: new Date("2023-03-17T15:49:29.368+00:00"),
              },
              {
                tableName: "newly-added-table",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "",
                numOfColumns: 16,
                dateCreated: new Date("2023-03-18T15:00:00.000+00:00"),
                dateUpdated: new Date("2023-03-18T15:00:00.300+00:00"),
              },
            ],
            dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
            dateUpdated: new Date("2023-03-18T15:00:00.300+00:00"),
          },
        ],
        dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
        dateUpdated: new Date("2023-03-18T15:00:00.300+00:00"),
      },
    ]);
  });

  it("Correctly updates the original informationSchema when a column is added to an existing table", async () => {
    const staleInformationSchema: InformationSchema[] = [
      {
        databaseName: "sample_database_name",
        path: "sample_org_id",
        schemas: [
          {
            schemaName: "sample_schema_name",
            path: "sample_org_id.sample_database_name",
            tables: [
              {
                tableName: "sample_table_name",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "sample_table_id-1",
                numOfColumns: 3,
                dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
                dateUpdated: new Date("2023-03-17T15:49:29.368+00:00"),
              },
              {
                tableName: "sample_table_name-with-no-id",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "",
                numOfColumns: 4,
                dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
                dateUpdated: new Date("2023-03-17T15:49:29.368+00:00"),
              },
              {
                tableName: "sample_table-3",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "sample_table_id-3",
                numOfColumns: 8,
                dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
                dateUpdated: new Date("2023-03-17T15:49:29.368+00:00"),
              },
              {
                tableName: "table-with-new-column-added",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "",
                numOfColumns: 16,
                dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
                dateUpdated: new Date("2023-03-17T15:49:29.368+00:00"),
              },
            ],
            dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
            dateUpdated: new Date("2023-03-17T15:49:29.368+00:00"),
          },
        ],
        dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
        dateUpdated: new Date("2023-03-17T15:49:29.368+00:00"),
      },
    ];
    const updatedInformationSchema: InformationSchema[] = [
      {
        databaseName: "sample_database_name",
        path: "sample_org_id",
        schemas: [
          {
            schemaName: "sample_schema_name",
            path: "sample_org_id.sample_database_name",
            tables: [
              {
                tableName: "sample_table_name",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "",
                numOfColumns: 3,
                dateCreated: new Date("2023-03-19T15:00:00.000+00:00"),
                dateUpdated: new Date("2023-03-19T15:00:00.300+00:00"),
              },
              {
                tableName: "sample_table_name-with-no-id",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "",
                numOfColumns: 4,
                dateCreated: new Date("2023-03-19T15:00:00.000+00:00"),
                dateUpdated: new Date("2023-03-19T15:00:00.300+00:00"),
              },
              {
                tableName: "sample_table-3",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "",
                numOfColumns: 8,
                dateCreated: new Date("2023-03-19T15:00:00.000+00:00"),
                dateUpdated: new Date("2023-03-19T15:00:00.300+00:00"),
              },
              {
                tableName: "table-with-new-column-added",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "",
                numOfColumns: 100,
                dateCreated: new Date("2023-03-19T15:00:00.000+00:00"),
                dateUpdated: new Date("2023-03-19T15:00:00.300+00:00"),
              },
            ],
            dateCreated: new Date("2023-03-19T15:00:00.000+00:00"),
            dateUpdated: new Date("2023-03-19T15:00:00.300+00:00"),
          },
        ],
        dateCreated: new Date("2023-03-19T15:00:00.000+00:00"),
        dateUpdated: new Date("2023-03-19T15:00:00.300+00:00"),
      },
    ];

    const mergedInformationSchema = await mergeStaleInformationSchemaWithUpdate(
      staleInformationSchema,
      updatedInformationSchema,
      "sample_org_id",
    );

    expect(mergedInformationSchema).toEqual([
      {
        databaseName: "sample_database_name",
        path: "sample_org_id",
        schemas: [
          {
            schemaName: "sample_schema_name",
            path: "sample_org_id.sample_database_name",
            tables: [
              {
                tableName: "sample_table_name",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "sample_table_id-1",
                numOfColumns: 3,
                dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
                dateUpdated: new Date("2023-03-17T15:49:29.368+00:00"),
              },
              {
                tableName: "sample_table_name-with-no-id",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "",
                numOfColumns: 4,
                dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
                dateUpdated: new Date("2023-03-17T15:49:29.368+00:00"),
              },
              {
                tableName: "sample_table-3",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "sample_table_id-3",
                numOfColumns: 8,
                dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
                dateUpdated: new Date("2023-03-17T15:49:29.368+00:00"),
              },
              {
                tableName: "table-with-new-column-added",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "",
                numOfColumns: 100,
                dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
                dateUpdated: new Date("2023-03-19T15:00:00.300+00:00"),
              },
            ],
            dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
            dateUpdated: new Date("2023-03-19T15:00:00.300+00:00"),
          },
        ],
        dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
        dateUpdated: new Date("2023-03-19T15:00:00.300+00:00"),
      },
    ]);
  });

  it("Correclty updates the original informationSchema when a table is removed", async () => {
    const staleInformationSchema: InformationSchema[] = [
      {
        databaseName: "sample_database_name",
        path: "sample_org_id",
        schemas: [
          {
            schemaName: "sample_schema_name",
            path: "sample_org_id.sample_database_name",
            tables: [
              {
                tableName: "sample_table_name",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "sample_table_id-1",
                numOfColumns: 3,
                dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
                dateUpdated: new Date("2023-03-17T15:49:29.368+00:00"),
              },
              {
                tableName: "sample_table_name-with-no-id",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "",
                numOfColumns: 4,
                dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
                dateUpdated: new Date("2023-03-17T15:49:29.368+00:00"),
              },
              {
                tableName: "sample_table-3",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "sample_table_id-3",
                numOfColumns: 8,
                dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
                dateUpdated: new Date("2023-03-17T15:49:29.368+00:00"),
              },
              {
                tableName: "table-to-be-deleted",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "",
                numOfColumns: 16,
                dateCreated: new Date("2023-03-18T15:00:00.000+00:00"),
                dateUpdated: new Date("2023-03-18T15:00:00.300+00:00"),
              },
            ],
            dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
            dateUpdated: new Date("2023-03-17T15:49:29.368+00:00"),
          },
        ],
        dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
        dateUpdated: new Date("2023-03-17T15:49:29.368+00:00"),
      },
    ];
    const updatedInformationSchema: InformationSchema[] = [
      {
        databaseName: "sample_database_name",
        path: "sample_org_id",
        schemas: [
          {
            schemaName: "sample_schema_name",
            path: "sample_org_id.sample_database_name",
            tables: [
              {
                tableName: "sample_table_name",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "",
                numOfColumns: 3,
                dateCreated: new Date("2023-03-18T15:00:00.000+00:00"),
                dateUpdated: new Date("2023-03-18T15:00:00.300+00:00"),
              },
              {
                tableName: "sample_table_name-with-no-id",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "",
                numOfColumns: 4,
                dateCreated: new Date("2023-03-18T15:00:00.000+00:00"),
                dateUpdated: new Date("2023-03-18T15:00:00.300+00:00"),
              },
              {
                tableName: "sample_table-3",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "",
                numOfColumns: 8,
                dateCreated: new Date("2023-03-18T15:00:00.000+00:00"),
                dateUpdated: new Date("2023-03-18T15:00:00.300+00:00"),
              },
            ],
            dateCreated: new Date("2023-03-18T15:00:00.000+00:00"),
            dateUpdated: new Date("2023-03-18T15:00:00.300+00:00"),
          },
        ],
        dateCreated: new Date("2023-03-18T15:00:00.000+00:00"),
        dateUpdated: new Date("2023-03-18T15:00:00.300+00:00"),
      },
    ];

    const mergedInformationSchema = await mergeStaleInformationSchemaWithUpdate(
      staleInformationSchema,
      updatedInformationSchema,
      "sample_org_id",
    );

    expect(mergedInformationSchema).toEqual([
      {
        databaseName: "sample_database_name",
        path: "sample_org_id",
        schemas: [
          {
            schemaName: "sample_schema_name",
            path: "sample_org_id.sample_database_name",
            tables: [
              {
                tableName: "sample_table_name",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "sample_table_id-1",
                numOfColumns: 3,
                dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
                dateUpdated: new Date("2023-03-17T15:49:29.368+00:00"),
              },
              {
                tableName: "sample_table_name-with-no-id",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "",
                numOfColumns: 4,
                dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
                dateUpdated: new Date("2023-03-17T15:49:29.368+00:00"),
              },
              {
                tableName: "sample_table-3",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "sample_table_id-3",
                numOfColumns: 8,
                dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
                dateUpdated: new Date("2023-03-17T15:49:29.368+00:00"),
              },
            ],
            dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
            dateUpdated: new Date("2023-03-18T15:00:00.300+00:00"),
          },
        ],
        dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
        dateUpdated: new Date("2023-03-18T15:00:00.300+00:00"),
      },
    ]);
  });
});

describe("removeRecentlyDeletedTables", () => {
  it("Returns the correct table id's that were recently removed", () => {
    const staleInformationSchema: InformationSchema[] = [
      {
        databaseName: "sample_database_name",
        path: "sample_org_id",
        schemas: [
          {
            schemaName: "sample_schema_name",
            path: "sample_org_id.sample_database_name",
            tables: [
              {
                tableName: "sample_table_name",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "sample_table_id-1",
                numOfColumns: 3,
                dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
                dateUpdated: new Date("2023-03-17T15:49:29.368+00:00"),
              },
              {
                tableName: "sample_table_name-with-no-id",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "",
                numOfColumns: 4,
                dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
                dateUpdated: new Date("2023-03-17T15:49:29.368+00:00"),
              },
              {
                tableName: "sample_table-3",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "sample_table_id-3",
                numOfColumns: 8,
                dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
                dateUpdated: new Date("2023-03-17T15:49:29.368+00:00"),
              },
              {
                tableName: "table-to-be-deleted",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "table_id_to_be_deleted-1234",
                numOfColumns: 16,
                dateCreated: new Date("2023-03-18T15:00:00.000+00:00"),
                dateUpdated: new Date("2023-03-18T15:00:00.300+00:00"),
              },
            ],
            dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
            dateUpdated: new Date("2023-03-17T15:49:29.368+00:00"),
          },
        ],
        dateCreated: new Date("2023-03-17T15:46:59.039+00:00"),
        dateUpdated: new Date("2023-03-17T15:49:29.368+00:00"),
      },
    ];
    const updatedInformationSchema: InformationSchema[] = [
      {
        databaseName: "sample_database_name",
        path: "sample_org_id",
        schemas: [
          {
            schemaName: "sample_schema_name",
            path: "sample_org_id.sample_database_name",
            tables: [
              {
                tableName: "sample_table_name",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "",
                numOfColumns: 3,
                dateCreated: new Date("2023-03-18T15:00:00.000+00:00"),
                dateUpdated: new Date("2023-03-18T15:00:00.300+00:00"),
              },
              {
                tableName: "sample_table_name-with-no-id",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "",
                numOfColumns: 4,
                dateCreated: new Date("2023-03-18T15:00:00.000+00:00"),
                dateUpdated: new Date("2023-03-18T15:00:00.300+00:00"),
              },
              {
                tableName: "sample_table-3",
                path: "sample_org_id.sample_database_name.sample_schema_name.sample_table_name",
                id: "",
                numOfColumns: 8,
                dateCreated: new Date("2023-03-18T15:00:00.000+00:00"),
                dateUpdated: new Date("2023-03-18T15:00:00.300+00:00"),
              },
            ],
            dateCreated: new Date("2023-03-18T15:00:00.000+00:00"),
            dateUpdated: new Date("2023-03-18T15:00:00.300+00:00"),
          },
        ],
        dateCreated: new Date("2023-03-18T15:00:00.000+00:00"),
        dateUpdated: new Date("2023-03-18T15:00:00.300+00:00"),
      },
    ];

    expect(
      getRecentlyDeletedTables(
        staleInformationSchema,
        updatedInformationSchema,
      ),
    ).toEqual(["table_id_to_be_deleted-1234"]);
  });
});
