import mongoose from "mongoose";
import { z } from "zod";
import uniqid from "uniqid";
import omit from "lodash/omit";
import {
  InformationSchema,
  InformationSchemaInterface,
} from "shared/types/integrations";
import { errorStringFromZodResult } from "back-end/src/util/validation";
import { logger } from "back-end/src/util/logger";

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
            dateCreated: z.date(),
            dateUpdated: z.date(),
            schemas: z.array(
              z.object({
                schemaName: z.string(),
                dateCreated: z.date(),
                dateUpdated: z.date(),
                tables: z.array(
                  z.object({
                    tableName: z.string(),
                    id: z.string(),
                    numOfColumns: z.number(),
                    dateCreated: z.date(),
                    dateUpdated: z.date(),
                  }),
                ),
              }),
            ),
          }),
        );

        const result = zodSchema.safeParse(value);

        if (!result.success) {
          const errorString = errorStringFromZodResult(result);
          logger.error(
            {
              error: JSON.stringify(errorString, null, 2),
              result: JSON.stringify(result, null, 2),
            },
            "Invalid database schema",
          );
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

const InformationSchemaModel = mongoose.model<InformationSchemaInterface>(
  "InformationSchema",
  informationSchema,
);

/**
 * Convert the Mongo document to an InformationSchemaInterface, omitting Mongo default fields __v, _id
 * @param doc
 */
const toInterface = (
  doc: InformationSchemaDocument,
): InformationSchemaInterface =>
  omit(doc.toJSON<InformationSchemaDocument>(), ["__v", "_id"]);

export async function createInformationSchema(
  informationSchema: InformationSchema[],
  organization: string,
  datasourceId: string,
): Promise<InformationSchemaInterface> {
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
  updates: Partial<InformationSchemaInterface>,
): Promise<void> {
  await InformationSchemaModel.updateOne(
    {
      id,
      organization,
    },
    {
      $set: updates,
    },
  );
}

export async function getInformationSchemaByDatasourceId(
  datasourceId: string,
  organization: string,
): Promise<InformationSchemaInterface | null> {
  const result = await InformationSchemaModel.findOne({
    organization,
    datasourceId,
  });

  if (!result) return null;

  return toInterface(result);
}

export async function getInformationSchemasByOrganization(
  organization: string,
): Promise<InformationSchemaInterface[] | null> {
  const results = await InformationSchemaModel.find({
    organization,
  });

  return results ? results.map(toInterface) : null;
}

export async function getInformationSchemaById(
  organization: string,
  informationSchemaId: string,
): Promise<InformationSchemaInterface | null> {
  const result = await InformationSchemaModel.findOne({
    organization,
    id: informationSchemaId,
  });

  return result ? toInterface(result) : null;
}

export async function deleteInformationSchemaById(
  organization: string,
  informationSchemaId: string,
): Promise<void> {
  await InformationSchemaModel.deleteOne({
    organization,
    id: informationSchemaId,
  });
}
