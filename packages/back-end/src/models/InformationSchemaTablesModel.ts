import omit from "lodash/omit";
import mongoose from "mongoose";
import uniqid from "uniqid";
import { Column } from "../types/Integration";

const informationSchemaTablesSchema = new mongoose.Schema({
  id: String,
  organization: String,
  table_name: String,
  columns: [
    {
      id: String,
      column_name: String,
      data_type: String,
      path: String,
    },
  ],
  dateCreated: Date,
  dateUpdated: Date,
});

type InformationSchemaTablesDocument = mongoose.Document & {
  id: string;
  columns: Column[];
};

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
): {
  id: string;
  columns: Column[];
} => omit(doc.toJSON(), ["__v", "_id"]);

export async function createInformationSchemaTable(
  columns: Column[],
  organization: string,
  table_name: string
) {
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
