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
import { removeDeletedTables } from "../models/InformationSchemaTablesModel";
import { getSourceIntegrationObject } from "./datasource";

export function removeRecentlyDeletedTables(
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
  updatedInformationSchema: InformationSchema[]
): Promise<InformationSchema[]> {
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
      schema.tables.forEach((table) => {
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
          table.id =
            staleInformationSchema[correspondingIndex].schemas[
              correspondingSchemaIndex
            ].tables[correspondingTableIndex].id;
          if (
            table.numOfColumns ===
            staleInformationSchema[correspondingIndex].schemas[
              correspondingSchemaIndex
            ].tables[correspondingTableIndex].numOfColumns
          ) {
            // If the number of columns hasn't changed, then we shoul set the dateUpdated to the stale date.
            table.dateUpdated =
              staleInformationSchema[correspondingIndex].schemas[
                correspondingSchemaIndex
              ].tables[correspondingTableIndex].dateUpdated;
          }

          //TODO: Should I add a property called 'forceRefresh' to the table object? and then if set
          // the next time someone goes to fetch it, we'll automatically refresh it?
          // I can do that if the number of columns changes
        }
      });
    });
  });

  return updatedInformationSchema;
}

export async function fetchTableData(
  databaseName: string,
  tableSchema: string,
  tableName: string,
  datasource: DataSourceInterface
): Promise<{ tableData: null | unknown[]; refreshMS: number }> {
  const integration = getSourceIntegrationObject(datasource);

  if (!integration.getTableData) {
    throw new Error("Table data not supported for this data source");
  }

  const { tableData, refreshMS } = await integration.getTableData(
    databaseName,
    tableSchema,
    tableName
  );

  return { tableData, refreshMS };
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

  return await integration.getInformationSchema();
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
    updatedInformationSchema
  );

  const tablesToDelete = await removeRecentlyDeletedTables(
    informationSchema.databases,
    updatedInformationSchema
  );

  if (tablesToDelete.length > 0) {
    await removeDeletedTables(
      organization,
      informationSchema.id,
      tablesToDelete
    );
  }

  // Update the empty informationSchema record with the actual informationSchema
  await updateInformationSchemaById(organization, informationSchema.id, {
    ...informationSchema,
    databases: mergedInformationSchema,
    status: "COMPLETE",
    error: undefined,
    refreshMS,
    dateUpdated: new Date(),
  });
}
