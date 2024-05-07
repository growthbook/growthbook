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
import { promiseAllChunks } from "../util/promise";
import { ApiReqContext } from "../../types/api";
import { ReqContext } from "../../types/organization";
import { getSourceIntegrationObject } from "./datasource";

export function getRecentlyDeletedTables(
  staleInformationSchema: InformationSchema[],
  updatedInformationSchema: InformationSchema[],
): string[] {
  const deletedTableIds: string[] = [];

  staleInformationSchema.forEach((database) => {
    const correspondingIndex = updatedInformationSchema.findIndex(
      (updatedInformationSchemaRecord) =>
        updatedInformationSchemaRecord.databaseName === database.databaseName,
    );
    database.schemas.forEach((schema) => {
      const correspondingSchemaIndex = updatedInformationSchema[
        correspondingIndex
      ].schemas.findIndex(
        (updatedSchemaRecord) =>
          updatedSchemaRecord.schemaName === schema.schemaName,
      );
      if (!schema.tables) return;
      schema.tables.forEach((table) => {
        // If this table has an id, then it exists in the informationSchemaTables collection
        if (
          table.id &&
          updatedInformationSchema?.[correspondingIndex]?.schemas?.[
            correspondingSchemaIndex
          ]?.tables
        ) {
          const correspondingTableIndex = updatedInformationSchema[
            correspondingIndex
          ].schemas[correspondingSchemaIndex].tables.findIndex(
            (updatedTableRecord) =>
              updatedTableRecord.tableName === table.tableName,
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
  organization: string,
): Promise<InformationSchema[]> {
  // If there is no stale information schema, then return the updated information schema
  // This could happen if there was an error when initially creating the informationSchema
  if (!staleInformationSchema || staleInformationSchema.length === 0) {
    return updatedInformationSchema;
  }

  const promises: (() => Promise<unknown>)[] = [];

  updatedInformationSchema.forEach((database) => {
    const correspondingIndex = staleInformationSchema.findIndex(
      (staleInformationSchemaRecord) =>
        staleInformationSchemaRecord.databaseName === database.databaseName,
    );
    // If the database exists in the staleInformationSchemaArray, then update the dateUpdated
    if (correspondingIndex > -1) {
      database.dateCreated =
        staleInformationSchema[correspondingIndex].dateCreated;
    }
    if (!database.schemas) return;
    database.schemas.forEach((schema) => {
      const correspondingSchemaIndex = staleInformationSchema[
        correspondingIndex
      ].schemas.findIndex(
        (staleSchemaRecord) =>
          staleSchemaRecord.schemaName === schema.schemaName,
      );

      if (correspondingSchemaIndex > -1) {
        schema.dateCreated =
          staleInformationSchema[correspondingIndex].schemas[
            correspondingSchemaIndex
          ].dateCreated;
      }
      if (!schema.tables) return;
      schema.tables.forEach((table) => {
        const staleInformationSchemaTables =
          staleInformationSchema[correspondingIndex].schemas[
            correspondingSchemaIndex
          ]?.tables || [];
        const correspondingTableIndex = staleInformationSchemaTables.findIndex(
          (staleTableRecord) => staleTableRecord.tableName === table.tableName,
        );

        if (
          correspondingTableIndex > -1 &&
          staleInformationSchemaTables[correspondingTableIndex]
        ) {
          const correspondingTable =
            staleInformationSchemaTables[correspondingTableIndex];
          table.dateCreated = correspondingTable.dateCreated;
          table.id = correspondingTable.id;
          if (table.numOfColumns === correspondingTable.numOfColumns) {
            // If the number of columns hasn't changed, then we should set the dateUpdated to the stale date.
            table.dateUpdated = correspondingTable.dateUpdated;
          } else {
            if (table.id) {
              // If numOfColumns has changed & the table has an id, then it needs to be updated.
              promises.push(() =>
                queueUpdateStaleInformationSchemaTable(organization, table.id),
              );
            }
          }
        }
      });
    });
  });

  if (promises.length > 0) {
    await promiseAllChunks(promises, 5);
  }

  return updatedInformationSchema;
}

export async function fetchTableData(
  context: ReqContext,
  datasource: DataSourceInterface,
  informationSchema: InformationSchemaInterface,
  tableId: string,
): Promise<{
  tableData: null | unknown[];
  refreshMS: number;
  databaseName: string;
  tableSchema: string;
  tableName: string;
}> {
  if (!context.permissions.canRunSchemaQueries(datasource)) {
    context.permissions.throwPermissionError();
  }

  const integration = getSourceIntegrationObject(context, datasource);

  if (!integration.getTableData) {
    throw new Error("Table data not supported for this data source");
  }

  let databaseName = "";
  let tableSchema = "";
  let tableName = "";
  informationSchema.databases.forEach((database) => {
    database.schemas.forEach((schema) => {
      if (!schema.tables) return;
      schema.tables.forEach((table) => {
        if (table.id === tableId) {
          databaseName = database.databaseName;
          tableSchema = schema.schemaName;
          tableName = table.tableName;
        }
      });
    });
  });

  const queryStartTime = Date.now();
  const { tableData } = await integration.getTableData(
    databaseName,
    tableSchema,
    tableName,
  );
  const queryEndTime = Date.now();

  return {
    tableData,
    refreshMS: queryEndTime - queryStartTime,
    databaseName,
    tableSchema,
    tableName,
  };
}

export async function generateInformationSchema(
  context: ReqContext,
  datasource: DataSourceInterface,
): Promise<{
  informationSchema: InformationSchema[];
  refreshMS: number;
}> {
  if (!context.permissions.canRunSchemaQueries(datasource)) {
    context.permissions.throwPermissionError();
  }

  const integration = getSourceIntegrationObject(context, datasource);

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
  context: ReqContext | ApiReqContext,
  datasource: DataSourceInterface,
): Promise<void> {
  // Create an empty informationSchema
  const emptyInformationSchema = await createInformationSchema(
    [],
    context.org.id,
    datasource.id,
  );

  // Update the datasource with the informationSchemaId
  await updateDataSource(context, datasource, {
    settings: {
      ...datasource.settings,
      informationSchemaId: emptyInformationSchema.id,
    },
  });

  const { informationSchema, refreshMS } = await generateInformationSchema(
    context,
    datasource,
  );

  // Update the empty informationSchema record with the actual informationSchema
  await updateInformationSchemaById(context.org.id, emptyInformationSchema.id, {
    ...emptyInformationSchema,
    databases: informationSchema,
    status: "COMPLETE",
    refreshMS,
  });
}

export async function updateDatasourceInformationSchema(
  context: ReqContext,
  datasource: DataSourceInterface,
  informationSchema: InformationSchemaInterface,
): Promise<void> {
  // Reset the informationSchema to remove any errors and change status to "PENDING"
  await updateInformationSchemaById(context.org.id, informationSchema.id, {
    status: "PENDING",
    error: null,
  });

  const { informationSchema: updatedInformationSchema, refreshMS } =
    await generateInformationSchema(context, datasource);

  const mergedInformationSchema = await mergeStaleInformationSchemaWithUpdate(
    informationSchema.databases,
    updatedInformationSchema,
    context.org.id,
  );

  const tablesToDelete = await getRecentlyDeletedTables(
    informationSchema.databases,
    updatedInformationSchema,
  );

  if (tablesToDelete.length > 0) {
    await removeDeletedInformationSchemaTables(
      context.org.id,
      informationSchema.id,
      tablesToDelete,
    );
  }

  await updateInformationSchemaById(context.org.id, informationSchema.id, {
    ...informationSchema,
    databases: mergedInformationSchema,
    status: "COMPLETE",
    error: null,
    refreshMS,
    dateUpdated: new Date(),
  });
}
