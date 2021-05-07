/*
import {Response} from "express";
import {AuthRequest} from "../types/AuthRequest";
import {getDataSourcesByOrganization, getDataSourceById} from "../services/datasource";
import {getTrackTableByDataSources, syncTrackTable} from "../services/events";

export async function getEvents(req: AuthRequest, res: Response) {
  const datasources = await getDataSourcesByOrganization(req.organization.id);

  if (!datasources || !datasources.length) {
    return res.status(200).json({
      status: 200,
      trackTables: [],
    });
  }

  const trackTables = await getTrackTableByDataSources(datasources.map(d => d.id));
  if (!trackTables || !trackTables.length) {
    return res.status(200).json({
      status: 200,
      trackTables: [],
    });
  }

  res.status(200).json({
    status: 200,
    trackTables: trackTables,
  });
}
export async function postEventsSync(req: AuthRequest<{datasource: string}>, res: Response) {
  const {datasource} = req.body;

  const datasourceObj = await getDataSourceById(datasource);

  if (!datasourceObj) {
    return res.status(404).json({
      status: 404,
      message: "Cannot find datasource: " + datasource
    });
  }
  if (datasourceObj.organization !== req.organization.id) {
    return res.status(403).json({
      status: 403,
      message: "Cannot access datasource: " + datasource
    });
  }

  try {
    await syncTrackTable(datasourceObj);
    res.status(200).json({
      status: 200
    });
  }
  catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message
    });
  }
}
*/
