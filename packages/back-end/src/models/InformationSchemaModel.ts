import mongoose from "mongoose";
import z from "zod";
import uniqid from "uniqid";
import {
  InformationSchemaInterface,
  InformationSchema,
} from "../types/Integration";
import { errorStringFromZodResult } from "../util/validation";
import { logger } from "../util/logger";
import { usingFileConfig } from "../init/config";

const informationSchema = new mongoose.Schema({
  id: String,
  organization: {
    type: String,
    index: true,
  },
  datasourceId: String,
  databases: {
    required: true,
    type: [Object],
    validate: {
      validator(value: unknown) {
        const zodSchema = z.array(
          z.object({
            databaseName: z.string(),
            path: z.string(),
            schemas: z.array(
              z.object({
                schemaName: z.string(),
                path: z.string(),
                tables: z.array(
                  z.object({
                    tableName: z.string(),
                    path: z.string(),
                    id: z.string(),
                    numOfColumns: z.number(),
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

type InformationSchemaDocument = mongoose.Document & InformationSchemaInterface;

const InformationSchemaModel = mongoose.model<InformationSchemaDocument>(
  "InformationSchema",
  informationSchema
);

export async function createInformationSchema(
  informationSchema: InformationSchema[],
  organization: string,
  datasourceId: string
): Promise<string | null> {
  //TODO: Remove this check and orgs usingFileConfig to create informationSchemas
  if (usingFileConfig()) {
    throw new Error("Cannot add. Data sources managed by config.yml");
  }

  const result = await InformationSchemaModel.create({
    id: uniqid("inf_"),
    datasourceId,
    organization,
    databases: informationSchema,
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });

  return result ? result.id : null;
}
