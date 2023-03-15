import { Response } from "express";
import { queueCreateInformationSchema } from "../jobs/createInformationSchema";
import { queueUpdateInformationSchema } from "../jobs/updateInformationSchema";
import { getDataSourceById } from "../models/DataSourceModel";
import { getTableDataByPath } from "../models/InformationSchemaTablesModel";
import { getOrgFromReq } from "../services/organizations";
import { AuthRequest } from "../types/AuthRequest";

export async function getTableData(
  req: AuthRequest<
    null,
    {
      databaseName: string;
      schemaName: string;
      tableName: string;
      datasourceId: string;
    }
  >,
  res: Response
) {
  const { org } = getOrgFromReq(req);

  const { databaseName, schemaName, tableName, datasourceId } = req.params;

  if (!databaseName || !schemaName || !tableName) {
    res.status(400).json({
      status: 400,
      message: "Missing required parameters.",
    });
    return;
  }

  const datasource = await getDataSourceById(datasourceId, org.id);

  if (!datasource) {
    res.status(404).json({ status: 404, message: "No datasource found" });
    return;
  }

  req.checkPermissions(
    "editDatasourceSettings",
    datasource?.projects?.length ? datasource.projects : ""
  );

  try {
    const table = await getTableDataByPath(
      org.id,
      databaseName,
      schemaName,
      tableName,
      datasource
    );

    res.status(200).json({
      status: 200,
      table,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message || "An error occurred.",
    });
  }
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
