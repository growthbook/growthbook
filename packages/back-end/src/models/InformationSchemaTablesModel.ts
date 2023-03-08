import omit from "lodash/omit";
import z from "zod";
import mongoose from "mongoose";
import { InformationSchemaTablesInterface } from "../types/Integration";
import { errorStringFromZodResult } from "../util/validation";
import { logger } from "../util/logger";

const informationSchemaTablesSchema = new mongoose.Schema({
  id: String,
  organization: {
    type: String,
    index: true,
  },
  tableName: String,
  tableSchema: String,
  databaseName: String,
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
  dateCreated: Date,
  dateUpdated: Date,
});

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
  const results = await InformationSchemaTablesModel.insertMany(tables);

  return results.map(toInterface);
}

export async function getTableDataByPath(
  organization: string,
  databaseName: string,
  schemaName: string,
  tableName: string
): Promise<InformationSchemaTablesInterface | null> {
  const table = await InformationSchemaTablesModel.findOne({
    organization,
    database_name: databaseName,
    table_schema: schemaName,
    table_name: tableName,
  });

  return table ? toInterface(table) : null;
}
