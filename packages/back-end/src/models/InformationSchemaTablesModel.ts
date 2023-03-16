import omit from "lodash/omit";
import z from "zod";
import mongoose from "mongoose";
import uniqid from "uniqid";
import { Column, InformationSchemaTablesInterface } from "../types/Integration";
import { errorStringFromZodResult } from "../util/validation";
import { logger } from "../util/logger";
import { usingFileConfig } from "../init/config";

const informationSchemaTablesSchema = new mongoose.Schema({
  id: String,
  datasourceId: String,
  organization: String,
  tableName: String,
  tableSchema: String,
  databaseName: String,
  informationSchemaId: String,
  columns: {
    type: [Object],
    required: true,
    validate: {
      validator(value: unknown) {
        const zodSchema = z.array(
          z.object({
            columnName: z.string(),
            path: z.string(),
            dataType: z.string(),
          })
        );

        const result = zodSchema.safeParse(value);

        if (!result.success) {
          const errorString = errorStringFromZodResult(result);
          logger.error(errorString, "Invalid Columns name");
        }

        return result.success;
      },
    },
  },
  refreshMS: Number,
  dateCreated: Date,
  dateUpdated: Date,
});

informationSchemaTablesSchema.index(
  { id: 1, organization: 1 },
  { unique: true }
);

type InformationSchemaTablesDocument = mongoose.Document &
  InformationSchemaTablesInterface;

const InformationSchemaTablesModel = mongoose.model<InformationSchemaTablesDocument>(
  "InformationSchemaTables",
  informationSchemaTablesSchema
);

/**
 * Convert the Mongo document to an InformationSourceInterface, omitting Mongo default fields __v, _id
 * @param doc
 */
const toInterface = (
  doc: InformationSchemaTablesDocument
): InformationSchemaTablesInterface => omit(doc.toJSON(), ["__v", "_id"]);

export async function createInformationSchemaTables(
  tables: InformationSchemaTablesInterface[]
): Promise<InformationSchemaTablesInterface[]> {
  //TODO: Remove this check and orgs usingFileConfig to create informationSchemas
  if (usingFileConfig()) {
    throw new Error("Cannot add. Data sources managed by config.yml");
  }

  const results = await InformationSchemaTablesModel.insertMany(tables);

  return results.map(toInterface);
}

export async function createInformationSchemaTable(
  organization: string,
  tableName: string,
  schemaName: string,
  databaseName: string,
  columns: Column[],
  refreshMS: number,
  datasourceId: string,
  informationSchemaId: string
): Promise<InformationSchemaTablesInterface> {
  if (usingFileConfig()) {
    throw new Error("Cannot add. Data sources managed by config.yml");
  }

  const result = await InformationSchemaTablesModel.create({
    id: uniqid("tbl_"),
    organization,
    tableName,
    tableSchema: schemaName,
    databaseName,
    columns,
    refreshMS,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    datasourceId,
    informationSchemaId,
  });

  return toInterface(result);
}

export async function getTableDataByPath(
  organization: string,
  databaseName: string,
  schemaName: string,
  tableName: string,
  informationSchemaId: string
): Promise<InformationSchemaTablesInterface | null> {
  const table = await InformationSchemaTablesModel.findOne({
    organization,
    databaseName: databaseName,
    tableSchema: schemaName,
    tableName: tableName,
    informationSchemaId,
  });

  return table ? toInterface(table) : null;
}

export async function getTableById(
  organization: string,
  id: string
): Promise<InformationSchemaTablesInterface | null> {
  const table = await InformationSchemaTablesModel.findOne({
    organization,
    id,
  });

  return table ? toInterface(table) : null;
}

export async function getTableByName(
  tableName: string,
  informationSchemaId: string,
  organization: string
): Promise<InformationSchemaTablesInterface | null> {
  const table = await InformationSchemaTablesModel.findOne({
    tableName,
    informationSchemaId,
    organization,
  });

  return table ? toInterface(table) : null;
}
