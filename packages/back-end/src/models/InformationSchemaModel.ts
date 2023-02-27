import omit from "lodash/omit";
import mongoose from "mongoose";
import uniqid from "uniqid";
import { InformationSchemaInterface } from "../../types/information-source";
import { InformationSchema } from "../types/Integration";

const informationSchema = new mongoose.Schema({
  id: String,
  organization: String,
  databases: [
    {
      database_name: String,
      path: String,
      schemas: [
        {
          schema_name: String,
          path: String,
          tables: [
            {
              table_name: String,
              path: String,
              columns_id: String,
            },
          ],
        },
      ],
    },
  ],
  dateCreated: Date,
  dateUpdated: Date,
});

type InformationSchemaDocument = mongoose.Document & InformationSchemaInterface;

const InformationSchemaModel = mongoose.model<InformationSchemaDocument>(
  "InformationSchema",
  informationSchema
);

/**
 * Convert the Mongo document to an InformationSourceInterface, omitting Mongo default fields __v, _id
 * @param doc
 */
const toInterface = (
  doc: InformationSchemaDocument
): InformationSchemaInterface => omit(doc.toJSON(), ["__v", "_id"]);

export async function createInformationSchema(
  informationSchema: InformationSchema[],
  organization: string
): Promise<InformationSchemaInterface | null> {
  const result = await InformationSchemaModel.create({
    id: uniqid("info-schema-"),
    organization,
    databases: informationSchema,
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });

  return result ? toInterface(result) : null;
}
