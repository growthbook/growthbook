import uniqid from "uniqid";
import { DataSourceInterface } from "../../types/datasource";
import {
  createInformationSchema,
  updateInformationSchemaById,
} from "../models/InformationSchemaModel";
import {
  InformationSchema,
  InformationSchemaInterface,
} from "../types/Integration";
import { updateDataSource } from "../models/DataSourceModel";
import { removeDeletedInformationSchemaTables } from "../models/InformationSchemaTablesModel";
import { queueUpdateStaleInformationSchemaTable } from "../jobs/updateStaleInformationSchemaTable";
import { getSourceIntegrationObject } from "./datasource";

export function getRecentlyDeletedTables(
  staleInformationSchema: InformationSchema[],
  updatedInformationSchema: InformationSchema[]
): string[] {
  const deletedTableIds: string[] = [];

  staleInformationSchema.forEach((database) => {
    const correspondingIndex = updatedInformationSchema.findIndex(
      (updatedInformationSchemaRecord) =>
        updatedInformationSchemaRecord.databaseName === database.databaseName
    );
    database.schemas.forEach((schema) => {
      const correspondingSchemaIndex = updatedInformationSchema[
        correspondingIndex
      ].schemas.findIndex(
        (updatedSchemaRecord) =>
          updatedSchemaRecord.schemaName === schema.schemaName
      );
      schema.tables.forEach((table) => {
        // If this table has an id, then it exists in the informationSchemaTables collection
        if (table.id) {
          const correspondingTableIndex = updatedInformationSchema[
            correspondingIndex
          ].schemas[correspondingSchemaIndex].tables.findIndex(
            (updatedTableRecord) =>
              updatedTableRecord.tableName === table.tableName
          );

          if (correspondingTableIndex === -1) {
            // This means that the table has been deleted.
            deletedTableIds.push(table.id);
          }
        }
      });
    });
  });
  return deletedTableIds;
}

export async function mergeStaleInformationSchemaWithUpdate(
  staleInformationSchema: InformationSchema[],
  updatedInformationSchema: InformationSchema[],
  organization: string
): Promise<InformationSchema[]> {
  // If there is no stale information schema, then return the updated information schema
  // This could happen if there was an error when initially creating the informationSchema
  if (!staleInformationSchema || staleInformationSchema.length === 0) {
    return updatedInformationSchema;
  }
  updatedInformationSchema.forEach((database) => {
    const correspondingIndex = staleInformationSchema.findIndex(
      (staleInformationSchemaRecord) =>
        staleInformationSchemaRecord.databaseName === database.databaseName
    );
    // If the database exists in the staleInformationSchemaArray, then update the dateUpdated
    if (correspondingIndex > -1) {
      database.dateCreated =
        staleInformationSchema[correspondingIndex].dateCreated;
    }
    database.schemas.forEach((schema) => {
      const correspondingSchemaIndex = staleInformationSchema[
        correspondingIndex
      ].schemas.findIndex(
        (staleSchemaRecord) =>
          staleSchemaRecord.schemaName === schema.schemaName
      );

      if (correspondingSchemaIndex > -1) {
        schema.dateCreated =
          staleInformationSchema[correspondingIndex].schemas[
            correspondingSchemaIndex
          ].dateCreated;
      }
      schema.tables.forEach(async (table) => {
        const correspondingTableIndex = staleInformationSchema[
          correspondingIndex
        ].schemas[correspondingSchemaIndex].tables.findIndex(
          (staleTableRecord) => staleTableRecord.tableName === table.tableName
        );

        if (correspondingTableIndex > -1) {
          table.dateCreated =
            staleInformationSchema[correspondingIndex].schemas[
              correspondingSchemaIndex
            ].tables[correspondingTableIndex].dateCreated;
          const existingId =
            staleInformationSchema[correspondingIndex].schemas[
              correspondingSchemaIndex
            ].tables[correspondingTableIndex].id;
          // There is a change the table doesn't have an id, in that case, we should create one.
          table.id = existingId || uniqid("tbl_");
          if (
            table.numOfColumns ===
            staleInformationSchema[correspondingIndex].schemas[
              correspondingSchemaIndex
            ].tables[correspondingTableIndex].numOfColumns
          ) {
            // If the number of columns hasn't changed, then we should set the dateUpdated to the stale date.
            table.dateUpdated =
              staleInformationSchema[correspondingIndex].schemas[
                correspondingSchemaIndex
              ].tables[correspondingTableIndex].dateUpdated;
          } else {
            if (table.id) {
              // If numOfColumns has changed & the table has an id, then it needs to be updated.
              await queueUpdateStaleInformationSchemaTable(
                organization,
                table.id
              );
            }
          }
        }
      });
    });
  });

  return updatedInformationSchema;
}

export async function fetchTableData(
  datasource: DataSourceInterface,
  informationSchema: InformationSchemaInterface,
  tableId: string
): Promise<{
  tableData: null | unknown[];
  refreshMS: number;
  databaseName: string;
  tableSchema: string;
  tableName: string;
}> {
  const integration = getSourceIntegrationObject(datasource);

  if (!integration.getTableData) {
    throw new Error("Table data not supported for this data source");
  }

  let databaseName = "";
  let tableSchema = "";
  let tableName = "";
  informationSchema.databases.forEach((database) => {
    database.schemas.forEach((schema) => {
      schema.tables.forEach((table) => {
        if (table.id === tableId) {
          databaseName = database.databaseName;
          tableSchema = schema.schemaName;
          tableName = table.tableName;
        }
      });
    });
  });

  const { tableData, refreshMS } = await integration.getTableData(
    databaseName,
    tableSchema,
    tableName
  );

  return { tableData, refreshMS, databaseName, tableSchema, tableName };
}

export async function generateInformationSchema(
  datasource: DataSourceInterface
): Promise<{
  informationSchema: InformationSchema[];
  refreshMS: number;
}> {
  const integration = getSourceIntegrationObject(datasource);

  if (!integration.getInformationSchema) {
    throw new Error("Information schema not supported for this data source");
  }

  const queryStartTime = Date.now();
  const informationSchema = await integration.getInformationSchema();
  const queryEndTime = Date.now();

  return {
    informationSchema,
    refreshMS: queryEndTime - queryStartTime,
  };
}

export async function initializeDatasourceInformationSchema(
  datasource: DataSourceInterface,
  organization: string
): Promise<void> {
  // Create an empty informationSchema
  const emptyInformationSchema = await createInformationSchema(
    [],
    organization,
    datasource.id
  );

  // Update the datasource with the informationSchemaId
  await updateDataSource(datasource.id, organization, {
    settings: {
      ...datasource.settings,
      informationSchemaId: emptyInformationSchema.id,
    },
  });

  const { informationSchema, refreshMS } = await generateInformationSchema(
    datasource
  );

  // Update the empty informationSchema record with the actual informationSchema
  await updateInformationSchemaById(organization, emptyInformationSchema.id, {
    ...emptyInformationSchema,
    databases: informationSchema,
    status: "COMPLETE",
    refreshMS,
  });
}

export async function updateDatasourceInformationSchema(
  datasource: DataSourceInterface,
  organization: string,
  informationSchema: InformationSchemaInterface
): Promise<void> {
  // Reset the informationSchema to remove any errors and change status to "PENDING"
  await updateInformationSchemaById(organization, informationSchema.id, {
    status: "PENDING",
    error: undefined,
  });

  const {
    informationSchema: updatedInformationSchema,
    refreshMS,
  } = await generateInformationSchema(datasource);

  const mergedInformationSchema = await mergeStaleInformationSchemaWithUpdate(
    informationSchema.databases,
    updatedInformationSchema,
    organization
  );

  const tablesToDelete = await getRecentlyDeletedTables(
    informationSchema.databases,
    updatedInformationSchema
  );

  if (tablesToDelete.length > 0) {
    await removeDeletedInformationSchemaTables(
      organization,
      informationSchema.id,
      tablesToDelete
    );
  }

  await updateInformationSchemaById(organization, informationSchema.id, {
    ...informationSchema,
    databases: mergedInformationSchema,
    status: "COMPLETE",
    error: undefined,
    refreshMS,
    dateUpdated: new Date(),
  });
}
