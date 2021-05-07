/*
import {ReportModel, Query, QueryResult} from "../models/ReportModel";
import {cacheKey, cacheGet, cacheSet} from "./redis";
import {query, getDataSourceById} from "../services/datasource";
import uniqid from "uniqid";

export function getAllReportsByOrganization(organization: string) {
  return ReportModel.find({
    organization
  });
}

export function createReport(organization: string) {
  return ReportModel.create({
    id: uniqid("rep_"),
    organization,
    title: "New Report",
    description: "",
    queries: [{
      query: "-- Put SQL query here...\n",
      showTable: true,
      source: "",
      visualizations: [],
    }],
    dateCreated: new Date(),
    dateUpdated: new Date()
  });
}

export function getReportById(id: string) {
  return ReportModel.findOne({
    id
  });
}

export async function runQuery(id: string, q: Query, useCache: boolean = true): Promise<QueryResult> {
  const key = cacheKey(id, q.datasource, q.query);
  if (useCache) {
    const cached = await cacheGet<QueryResult>(key);
    if (cached) {
      return cached;
    }
  }

  const datasource = await getDataSourceById(q.datasource);

  // TODO: use postgres client specific to this source (with properly scoped permissions)
  const rows = await query<{[key: string]: string}>(datasource, q.query);
  const result = {
    timestamp: new Date(),
    rows
  };

  await cacheSet(key, 3600, result);
  return result;
}

export async function runReport(id: string, useCache: boolean = true) {
  const report = await getReportById(id);

  const resultPromises = report.queries.map(async (q) => runQuery(id, q, useCache));

  // TODO: use allSettled so we can get back partial results if a subset of queries fail
  const results = await Promise.all(resultPromises);

  return results;
}
*/
