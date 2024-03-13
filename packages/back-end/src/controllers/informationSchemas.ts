import { Response } from "express";
import { fetchTableData } from "@/src/services/informationSchema";
import { getContextFromReq } from "@/src/services/organizations";
import { getPath } from "@/src/util/informationSchemas";
import { getDataSourceById } from "@/src/models/DataSourceModel";
import { getInformationSchemaByDatasourceId } from "@/src/models/InformationSchemaModel";
import {
  createInformationSchemaTable,
  getInformationSchemaTableById,
} from "@/src/models/InformationSchemaTablesModel";
import { Column } from "@/src/types/Integration";
import { AuthRequest } from "@/src/types/AuthRequest";
import { queueUpdateStaleInformationSchemaTable } from "@/src/jobs/updateStaleInformationSchemaTable";
import { queueUpdateInformationSchema } from "@/src/jobs/updateInformationSchema";
import { queueCreateInformationSchema } from "@/src/jobs/createInformationSchema";

export async function getInformationSchema(
  req: AuthRequest<null, { datasourceId: string }>,
  res: Response
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
    org.id
  );

  res.status(200).json({
    status: 200,
    informationSchema,
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
  res: Response
) {
  const context = getContextFromReq(req);
  const { org } = context;

  const { datasourceId, tableId } = req.params;

  const informationSchema = await getInformationSchemaByDatasourceId(
    datasourceId,
    org.id
  );

  if (!informationSchema) {
    res
      .status(404)
      .json({ status: 404, message: "No informationSchema found" });
    return;
  }

  const datasource = await getDataSourceById(
    context,
    informationSchema.datasourceId
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
  const {
    tableData,
    refreshMS,
    databaseName,
    tableSchema,
    tableName,
  } = await fetchTableData(datasource, informationSchema, tableId);

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
        path: getPath(datasource.type, {
          tableCatalog: databaseName,
          tableSchema: tableSchema,
          tableName: tableName,
          columnName: row.column_name,
        }),
      };
    }
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
  res: Response
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
  res: Response
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

  req.checkPermissions(
    "runQueries",
    datasource?.projects?.length ? datasource.projects : []
  );

  await queueUpdateInformationSchema(
    datasource.id,
    org.id,
    informationSchemaId
  );

  res.status(200).json({ message: "Job scheduled successfully" });
}
