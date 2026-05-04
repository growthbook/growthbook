import { z } from "zod";

import { namedSchema } from "./openapi-helpers";

// Corresponds to schemas/InformationSchema.yaml
export const apiInformationSchemaValidator = namedSchema(
  "InformationSchema",
  z
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
    .strict(),
);
export type ApiInformationSchema = z.infer<
  typeof apiInformationSchemaValidator
>;

// Corresponds to schemas/InformationSchemaTable.yaml
export const apiInformationSchemaTableValidator = namedSchema(
  "InformationSchemaTable",
  z
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
    .strict(),
);

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
  description:
    "Returns cached database schema metadata for a data source, including databases, schemas, and tables. The information schema is automatically created when a SQL-based data source is added. Not all data source types support information schemas.",
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
  description:
    "Returns cached metadata for a specific table in the Data Source, including columns and their data types. Not all data source types support information schemas.",
  operationId: "getInformationSchemaTable",
  tags: ["data-sources"],
  method: "get" as const,
  path: "/information-schema-tables/:tableId",
};
