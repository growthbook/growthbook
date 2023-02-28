import mongoose from "mongoose";
import uniqid from "uniqid";
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
              id: String,
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

type InformationSchemaDocument = mongoose.Document & InformationSchema;

const InformationSchemaModel = mongoose.model<InformationSchemaDocument>(
  "InformationSchema",
  informationSchema
);

export async function createInformationSchema(
  informationSchema: InformationSchema[],
  organization: string
): Promise<string | null> {
  const result = await InformationSchemaModel.create({
    id: uniqid("info-schema-"),
    organization,
    databases: informationSchema,
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });

  return result ? result.id : null;
}
