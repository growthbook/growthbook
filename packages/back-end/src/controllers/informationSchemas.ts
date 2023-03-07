import { Response } from "express";
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
    }
  >,
  res: Response
) {
  const { org } = getOrgFromReq(req);

  // TODO: Validate user has permission

  const { databaseName, schemaName, tableName } = req.params;

  if (!databaseName || !schemaName || !tableName) {
    res.status(400).json({
      status: 400,
      message: "Missing required parameters.",
    });
    return;
  }

  try {
    const table = await getTableDataByPath(
      org.id,
      databaseName,
      schemaName,
      tableName
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
