import omit from "lodash/omit";
import z from "zod";
import mongoose from "mongoose";
import uniqid from "uniqid";
import { InformationSchemaTablesInterface } from "../types/Integration";
import { errorStringFromZodResult } from "../util/validation";
import { logger } from "../util/logger";
import { fetchTableData } from "../services/datasource";
import { getDataSourceById } from "./DataSourceModel";

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
            // path: z.string(),
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

export async function createInformationSchemaTable(
  table: InformationSchemaTablesInterface
): Promise<InformationSchemaTablesInterface | null> {
  const result = await InformationSchemaTablesModel.create(table);

  return result ? toInterface(result) : null;
}

export async function getTableDataByPath(
  organization: string,
  databaseName: string,
  schemaName: string,
  tableName: string,
  datasourceId: string
): Promise<InformationSchemaTablesInterface | null> {
  const table = await InformationSchemaTablesModel.findOne({
    organization,
    databaseName: databaseName,
    tableSchema: schemaName,
    tableName: tableName,
  });

  if (table) {
    return table ? toInterface(table) : null;
  }
  let newTable;

  const datasource = await getDataSourceById(datasourceId, organization);

  if (datasource) {
    // We need to fetch table data from the datasource
    const tableData = await fetchTableData(
      databaseName,
      schemaName,
      tableName,
      datasource
    );
    // If we get the tableData, then we need to create a new document and return it to the user
    if (tableData) {
      newTable = await createInformationSchemaTable({
        id: uniqid("tbl_"),
        organization,
        tableName,
        tableSchema: schemaName,
        databaseName,
        columns: tableData.map(
          (row: { column_name: string; data_type: string }) => {
            return {
              columnName: row.column_name,
              dataType: row.data_type,
            };
          }
        ),
        dateCreated: new Date(),
        dateUpdated: new Date(),
      });
    }
  }

  return newTable || null;
}
