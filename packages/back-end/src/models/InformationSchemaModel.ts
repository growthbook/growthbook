import mongoose from "mongoose";
import z from "zod";
import uniqid from "uniqid";
import { InformationSchema } from "../types/Integration";
import { errorStringFromZodResult } from "../util/validation";
import { logger } from "../util/logger";

const informationSchema = new mongoose.Schema({
  id: String,
  organization: {
    type: String,
    index: true,
  },
  databases: {
    required: true,
    type: [Object],
    validate: {
      validator(value: unknown) {
        const zodSchema = z.array(
          z.object({
            database_name: z.string(),
            path: z.string(),
            schemas: z.array(
              z.object({
                schema_name: z.string(),
                path: z.string(),
                tables: z.array(
                  z.object({
                    table_name: z.string(),
                    path: z.string(),
                  })
                ),
              })
            ),
          })
        );

        const result = zodSchema.safeParse(value);

        if (!result.success) {
          const errorString = errorStringFromZodResult(result);
          logger.error(errorString, "Invalid database schema");
        }

        return result.success;
      },
    },
  },
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
