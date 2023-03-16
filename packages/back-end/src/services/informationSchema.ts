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
import { getSourceIntegrationObject } from "./datasource";

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
    ...informationSchema,
    status: "PENDING",
    error: undefined,
  });

  const {
    informationSchema: updatedInformationSchema,
    refreshMS,
  } = await generateInformationSchema(datasource);

  // Update the empty informationSchema record with the actual informationSchema
  await updateInformationSchemaById(organization, informationSchema.id, {
    ...informationSchema,
    databases: updatedInformationSchema,
    status: "COMPLETE",
    error: undefined,
    refreshMS,
  });
}
