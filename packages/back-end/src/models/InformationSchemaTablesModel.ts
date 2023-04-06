import omit from "lodash/omit";
import z from "zod";
import mongoose from "mongoose";
import { errorStringFromZodResult } from "../util/validation";
import { logger } from "../util/logger";
import { usingFileConfig } from "../init/config";
import { InformationSchemaTablesInterface } from "../types/Integration";

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
          logger.error(
            {
              error: JSON.stringify(errorString, null, 2),
              result: JSON.stringify(result, null, 2),
            },
            "Invalid Columns name"
          );
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

export async function createInformationSchemaTable(
  tableData: Omit<
    InformationSchemaTablesInterface,
    "dateCreated" | "dateUpdated"
  >
): Promise<InformationSchemaTablesInterface> {
  //TODO: GB-82 Remove this check and orgs usingFileConfig to create informationSchemas
  if (usingFileConfig()) {
    throw new Error("Cannot add. Data sources managed by config.yml");
  }

  const result = await InformationSchemaTablesModel.create({
    ...tableData,
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });

  return toInterface(result);
}

export async function getInformationSchemaTableById(
  organization: string,
  id: string
): Promise<InformationSchemaTablesInterface | null> {
  const table = await InformationSchemaTablesModel.findOne({
    organization,
    id,
  });

  return table ? toInterface(table) : null;
}

export async function updateInformationSchemaTableById(
  organization: string,
  id: string,
  updates: Partial<InformationSchemaTablesInterface>
): Promise<void> {
  await InformationSchemaTablesModel.updateOne(
    {
      id,
      organization,
    },
    {
      $set: updates,
    }
  );
}

export async function removeDeletedInformationSchemaTables(
  organization: string,
  informationSchemaId: string,
  tableIds: string[]
): Promise<void> {
  await InformationSchemaTablesModel.deleteMany({
    organization,
    informationSchemaId,
    id: { $in: tableIds },
  });
}
