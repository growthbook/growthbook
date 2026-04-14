import { z } from "zod";

// Corresponds to schemas/InformationSchema.yaml
export const apiInformationSchemaValidator = z
  .object({
    id: z.string(),
    datasourceId: z.string(),
    status: z.enum(["PENDING", "COMPLETE"]),
    error: z
      .object({
        errorType: z.enum(["generic", "not_supported", "missing_params"]),
        message: z.string(),
      })
      .optional(),
    databases: z.array(
      z.object({
        databaseName: z.string(),
        path: z.string().optional(),
        dateCreated: z.string().meta({ format: "date-time" }),
        dateUpdated: z.string().meta({ format: "date-time" }),
        schemas: z.array(
          z.object({
            schemaName: z.string(),
            path: z.string().optional(),
            dateCreated: z.string().meta({ format: "date-time" }),
            dateUpdated: z.string().meta({ format: "date-time" }),
            tables: z.array(
              z.object({
                tableName: z.string(),
                path: z.string().optional(),
                id: z.string(),
                numOfColumns: z.coerce.number(),
                dateCreated: z.string().meta({ format: "date-time" }),
                dateUpdated: z.string().meta({ format: "date-time" }),
              }),
            ),
          }),
        ),
      }),
    ),
    dateCreated: z.string().meta({ format: "date-time" }),
    dateUpdated: z.string().meta({ format: "date-time" }),
  })
  .strict();

// Corresponds to schemas/InformationSchemaTable.yaml
export const apiInformationSchemaTableValidator = z
  .object({
    id: z.string(),
    datasourceId: z.string(),
    informationSchemaId: z.string(),
    tableName: z.string(),
    tableSchema: z.string(),
    databaseName: z.string(),
    columns: z.array(
      z.object({
        columnName: z.string(),
        dataType: z.string(),
      }),
    ),
    refreshMS: z.coerce.number(),
    dateCreated: z.string().meta({ format: "date-time" }),
    dateUpdated: z.string().meta({ format: "date-time" }),
  })
  .strict();

const dataSourceIdParams = z
  .object({
    dataSourceId: z.string().describe("The id of the data source"),
  })
  .strict();

const tableIdParams = z
  .object({
    tableId: z.string().describe("The id of the information schema table"),
  })
  .strict();

export const getInformationSchemaValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: dataSourceIdParams,
  responseSchema: z
    .object({
      informationSchema: apiInformationSchemaValidator,
    })
    .strict(),
  summary: "Get a Data Source's Information Schema",
  operationId: "getInformationSchema",
  tags: ["data-sources"],
  method: "get" as const,
  path: "/data-sources/:dataSourceId/information-schema",
};

export const getInformationSchemaTableValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: tableIdParams,
  responseSchema: z
    .object({
      informationSchemaTable: apiInformationSchemaTableValidator,
    })
    .strict(),
  summary: "Get a single Information Schema Table by id",
  operationId: "getInformationSchemaTable",
  tags: ["data-sources"],
  method: "get" as const,
  path: "/information-schema-tables/:tableId",
};
