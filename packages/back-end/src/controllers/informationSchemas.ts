import { Response } from "express";
import { queueCreateInformationSchema } from "../jobs/createInformationSchema";
import { queueUpdateInformationSchema } from "../jobs/updateInformationSchema";
import { queueUpdateStaleInformationSchemaTable } from "../jobs/updateStaleInformationSchemaTable";
import { getDataSourceById } from "../models/DataSourceModel";
import {
  getInformationSchemaById,
  updateInformationSchemaById,
} from "../models/InformationSchemaModel";
import {
  createInformationSchemaTable,
  getTableDataByPath,
} from "../models/InformationSchemaTablesModel";
import { fetchTableData } from "../services/informationSchema";
import { getOrgFromReq } from "../services/organizations";
import { AuthRequest } from "../types/AuthRequest";
import { Column } from "../types/Integration";
import { getPath } from "../util/informationSchemas";

export async function getTableData(
  req: AuthRequest<
    null,
    {
      databaseName: string;
      schemaName: string;
      tableName: string;
      id: string;
    }
  >,
  res: Response
) {
  const { org } = getOrgFromReq(req);

  const { databaseName, schemaName, tableName, id } = req.params;

  const informationSchema = await getInformationSchemaById(org.id, id);

  if (!informationSchema) {
    res
      .status(404)
      .json({ status: 404, message: "No informationSchema found" });
    return;
  }

  const datasource = await getDataSourceById(
    informationSchema.datasourceId,
    org.id
  );

  if (!datasource) {
    res.status(404).json({ status: 404, message: "No datasource found" });
    return;
  }

  const table = await getTableDataByPath(
    org.id,
    databaseName,
    schemaName,
    tableName,
    id
  );

  // If the table exists, just return it and update it in the background if it's out of date.
  if (table) {
    const currentDate = new Date();
    const dateLastUpdated = new Date(table.dateUpdated);

    // To calculate the time difference of two dates
    const diffInMilliseconds =
      currentDate.getTime() - dateLastUpdated.getTime();

    // To calculate the no. of days between two dates
    const diffInDays = Math.floor(diffInMilliseconds / (1000 * 3600 * 24));

    if (diffInDays > 30) {
      await queueUpdateStaleInformationSchemaTable(org.id, table.id);
    }
    res.status(200).json({
      status: 200,
      table,
    });
    return;
  }

  // Otherwise, the table doesn't exist yet, so we need to create it.
  const { tableData, refreshMS } = await fetchTableData(
    databaseName,
    schemaName,
    tableName,
    datasource
  );

  if (!tableData || !refreshMS) {
    res
      .status(400)
      .json({ status: 400, message: "Unable to retrieve table data." });
    return;
  }

  const columns: Column[] = tableData.map(
    (row: { column_name: string; data_type: string }) => {
      return {
        columnName: row.column_name,
        dataType: row.data_type,
        path: getPath(datasource.type, {
          tableCatalog: databaseName,
          tableSchema: schemaName,
          tableName: tableName,
          columnName: row.column_name,
        }),
      };
    }
  );

  // Create the table record in Mongo.
  const newTable = await createInformationSchemaTable(
    org.id,
    tableName,
    schemaName,
    databaseName,
    columns,
    refreshMS,
    datasource.id,
    id
  );

  const databaseIndex = informationSchema.databases.findIndex(
    (database) => database.databaseName === databaseName
  );

  // Update the nested table in the informationSchema document to reference the newly created table.id
  // and update the dateUpdated fields on that table and on the main informationSchema document.
  //TODO: Optimize with Maps?
  const schemaIndex = informationSchema.databases[
    databaseIndex
  ].schemas.findIndex((schema) => schema.schemaName === schemaName);

  const tableIndex = informationSchema.databases[databaseIndex].schemas[
    schemaIndex
  ].tables.findIndex((table) => table.tableName === tableName);

  informationSchema.databases[databaseIndex].schemas[schemaIndex].tables[
    tableIndex
  ].id = newTable.id;

  informationSchema.databases[databaseIndex].schemas[schemaIndex].tables[
    tableIndex
  ].dateUpdated = new Date();

  await updateInformationSchemaById(org.id, informationSchema.id, {
    databases: informationSchema.databases,
  });
  res.status(200).json({ status: 200, table: newTable });
}

export async function postInformationSchema(
  req: AuthRequest<null, { datasourceId: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);

  const datasource = await getDataSourceById(req.params.datasourceId, org.id);

  if (!datasource) {
    res.status(404).json({
      status: 404,
      message: "Unable to find datasource.",
    });
    return;
  }

  req.checkPermissions(
    "editDatasourceSettings",
    datasource?.projects?.length ? datasource.projects : ""
  );

  await queueCreateInformationSchema(datasource.id, org.id);

  res.status(200).json({ message: "Job scheduled successfully" });
}

export async function putInformationSchema(
  req: AuthRequest<{ informationSchemaId: string }, { datasourceId: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { informationSchemaId } = req.body;

  const datasource = await getDataSourceById(req.params.datasourceId, org.id);

  if (!datasource) {
    res.status(404).json({
      status: 404,
      message: "Unable to find datasource.",
    });
    return;
  }

  req.checkPermissions(
    "editDatasourceSettings",
    datasource?.projects?.length ? datasource.projects : ""
  );

  await queueUpdateInformationSchema(
    datasource.id,
    org.id,
    informationSchemaId
  );

  res.status(200).json({ message: "Job scheduled successfully" });
}

export async function getInformationSchemaStatus(
  req: AuthRequest<null, { datasourceId: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);

  const datasource = await getDataSourceById(req.params.datasourceId, org.id);

  if (!datasource) {
    res.status(404).json({
      status: 404,
      message: "Unable to find datasource.",
    });
    return;
  }

  if (!datasource.settings.informationSchemaId) {
    res.status(404).json({
      status: 404,
      message: "No information schema found.",
    });
    return;
  }

  const informationSchema = await getInformationSchemaById(
    org.id,
    datasource.settings.informationSchemaId
  );

  if (!informationSchema) {
    res.status(404).json({
      status: 404,
      message: "Unable to find information schema.",
    });
    return;
  }

  return res.status(200).json({
    status: 200,
    isComplete: informationSchema.status === "COMPLETE",
  });
}
