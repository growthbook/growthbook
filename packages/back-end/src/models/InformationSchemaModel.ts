import mongoose from "mongoose";
import z from "zod";
import uniqid from "uniqid";
import omit from "lodash/omit";
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
            dateCreated: z.date(),
            dateUpdated: z.date(),
            schemas: z.array(
              z.object({
                schemaName: z.string(),
                path: z.string(),
                dateCreated: z.date(),
                dateUpdated: z.date(),
                tables: z.array(
                  z.object({
                    tableName: z.string(),
                    path: z.string(),
                    id: z.string(),
                    numOfColumns: z.number(),
                    dateCreated: z.date(),
                    dateUpdated: z.date(),
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
  status: String,
  error: {
    errorType: String,
    message: String,
  },
  dateCreated: Date,
  dateUpdated: Date,
});

type InformationSchemaDocument = mongoose.Document & InformationSchemaInterface;

const InformationSchemaModel = mongoose.model<InformationSchemaDocument>(
  "InformationSchema",
  informationSchema
);

/**
 * Convert the Mongo document to an InformationSchemaInterface, omitting Mongo default fields __v, _id
 * @param doc
 */
const toInterface = (
  doc: InformationSchemaDocument
): InformationSchemaInterface => omit(doc.toJSON(), ["__v", "_id"]);

export async function createInformationSchema(
  informationSchema: InformationSchema[],
  organization: string,
  datasourceId: string
): Promise<InformationSchemaInterface> {
  //TODO: Remove this check and orgs usingFileConfig to create informationSchemas
  if (usingFileConfig()) {
    throw new Error("Cannot add. Data sources managed by config.yml");
  }

  const result = await InformationSchemaModel.create({
    id: uniqid("inf_"),
    datasourceId,
    organization,
    status: "PENDING",
    databases: informationSchema,
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });

  return toInterface(result);
}

export async function updateInformationSchemaById(
  organization: string,
  id: string,
  updates: Partial<InformationSchemaInterface>
): Promise<void> {
  //TODO: Remove this check and orgs usingFileConfig to create informationSchemas
  if (usingFileConfig()) {
    throw new Error("Cannot add. Data sources managed by config.yml");
  }

  await InformationSchemaModel.updateOne(
    {
      id,
      organization,
    },
    {
      $set: updates,
    }
  );
}

export async function getInformationSchemaByDatasourceId(
  datasourceId: string,
  organization: string
): Promise<InformationSchemaInterface | null> {
  const result = await InformationSchemaModel.findOne({
    organization,
    datasourceId,
  });

  if (!result) return null;

  return toInterface(result);
}
