import { Response } from "express";
import { queueCreateInformationSchema } from "back-end/src/jobs/createInformationSchema";
import { queueUpdateInformationSchema } from "back-end/src/jobs/updateInformationSchema";
import { queueUpdateStaleInformationSchemaTable } from "back-end/src/jobs/updateStaleInformationSchemaTable";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getInformationSchemaByDatasourceId } from "back-end/src/models/InformationSchemaModel";
import {
  createInformationSchemaTable,
  getInformationSchemaTableById,
} from "back-end/src/models/InformationSchemaTablesModel";
import {
  fetchTableData,
  getInformationSchemaWithPaths,
} from "back-end/src/services/informationSchema";
import { getContextFromReq } from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { Column } from "back-end/src/types/Integration";

export async function getInformationSchema(
  req: AuthRequest<null, { datasourceId: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org } = context;

  const datasource = await getDataSourceById(context, req.params.datasourceId);

  if (!datasource) {
    res.status(404).json({
      status: 404,
      message: "Unable to find datasource.",
    });
    return;
  }

  const informationSchema = await getInformationSchemaByDatasourceId(
    datasource.id,
    org.id,
  );

  res.status(200).json({
    status: 200,
    informationSchema: informationSchema
      ? getInformationSchemaWithPaths(informationSchema, datasource.type)
      : null,
  });
}

export async function getTableData(
  req: AuthRequest<
    null,
    {
      datasourceId: string;
      tableId: string;
    }
  >,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org } = context;

  const { datasourceId, tableId } = req.params;

  const informationSchema = await getInformationSchemaByDatasourceId(
    datasourceId,
    org.id,
  );

  if (!informationSchema) {
    res
      .status(404)
      .json({ status: 404, message: "No informationSchema found" });
    return;
  }

  const datasource = await getDataSourceById(
    context,
    informationSchema.datasourceId,
  );

  if (!datasource) {
    res.status(404).json({ status: 404, message: "No datasource found" });
    return;
  }

  const table = await getInformationSchemaTableById(org.id, tableId);

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
  const { tableData, refreshMS, databaseName, tableSchema, tableName } =
    await fetchTableData(context, datasource, informationSchema, tableId);

  if (!tableData) {
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
      };
    },
  );

  // Create the table record in Mongo.
  const newTable = await createInformationSchemaTable({
    organization: org.id,
    tableName,
    tableSchema,
    databaseName,
    columns,
    refreshMS,
    datasourceId: datasource.id,
    informationSchemaId: informationSchema.id,
    id: tableId,
  });

  res.status(200).json({ status: 200, table: newTable });
}

export async function putTableData(
  req: AuthRequest<
    null,
    {
      datasourceId: string;
      tableId: string;
    }
  >,
  res: Response,
) {
  const { org } = getContextFromReq(req);
  const { tableId } = req.params;

  const table = await getInformationSchemaTableById(org.id, tableId);

  if (!table) {
    res.status(404).json({
      status: 404,
      message: "Unable to find table to update.",
    });
    return;
  }

  await queueUpdateStaleInformationSchemaTable(org.id, table.id);

  res.status(200).json({ message: "Job scheduled successfully" });
}

export async function postInformationSchema(
  req: AuthRequest<null, { datasourceId: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org } = context;

  const datasource = await getDataSourceById(context, req.params.datasourceId);

  if (!datasource) {
    res.status(404).json({
      status: 404,
      message: "Unable to find datasource.",
    });
    return;
  }

  if (!context.permissions.canUpdateDataSourceSettings(datasource)) {
    context.permissions.throwPermissionError();
  }

  await queueCreateInformationSchema(datasource.id, org.id);

  res.status(200).json({ message: "Job scheduled successfully" });
}

export async function putInformationSchema(
  req: AuthRequest<{ informationSchemaId: string }, { datasourceId: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { informationSchemaId } = req.body;

  const datasource = await getDataSourceById(context, req.params.datasourceId);

  if (!datasource) {
    res.status(404).json({
      status: 404,
      message: "Unable to find datasource.",
    });
    return;
  }

  if (!context.permissions.canRunSchemaQueries(datasource)) {
    context.permissions.throwPermissionError();
  }

  await queueUpdateInformationSchema(
    datasource.id,
    org.id,
    informationSchemaId,
  );

  res.status(200).json({ message: "Job scheduled successfully" });
}
