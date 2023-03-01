import omit from "lodash/omit";
import z from "zod";
import mongoose from "mongoose";
import uniqid from "uniqid";
import { Column, InformationSchemaTablesInterface } from "../types/Integration";
import { errorStringFromZodResult } from "../util/validation";
import { logger } from "../util/logger";

const informationSchemaTablesSchema = new mongoose.Schema({
  id: String,
  organization: String,
  table_name: String,
  columns: {
    type: [Object],
    required: true,
    validate: {
      validator(value: unknown) {
        const zodSchema = z.array(
          z.object({
            column_name: z.string(),
            path: z.string(),
            data_type: z.string(),
          })
        );

        const result = zodSchema.safeParse(value);

        if (!result.success) {
          const errorString = errorStringFromZodResult(result);
          logger.error(errorString, "Invalid Columns name"); //MKTODO: Update this to be more accurate
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

export async function createInformationSchemaTable(
  columns: Column[],
  organization: string,
  table_name: string
): Promise<InformationSchemaTablesInterface> {
  const result = await InformationSchemaTablesModel.create({
    id: uniqid("table_"),
    organization,
    table_name,
    columns,
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });

  return toInterface(result);
}
