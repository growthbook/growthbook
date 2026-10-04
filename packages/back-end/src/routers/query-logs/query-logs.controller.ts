import type { Response } from "express";
import type {
  DataSourceUsage,
  QueryInterface,
  QueryLogInterface,
} from "shared/types/query";
import { getContextFromReq } from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getExperimentsByIds } from "back-end/src/models/ExperimentModel";
import { getFactTablesByIds } from "back-end/src/models/FactTableModel";
import { getRunningQueriesByDatasource } from "back-end/src/models/QueryModel";

const USAGE_WINDOW_DAYS = 30;

export const getDataSourceUsage = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{
    status: 200;
    usage: DataSourceUsage;
    recent: QueryLogInterface[];
    running: Pick<
      QueryInterface,
      "id" | "queryType" | "status" | "createdAt" | "startedAt"
    >[];
    experimentNames: Record<string, string>;
    factTablesWithoutDateFilter: string[];
  }>,
) => {
  const context = getContextFromReq(req);
  const datasource = await getDataSourceById(context, req.params.id);
  if (!datasource) {
    throw new Error("Could not find Data Source");
  }

  const since = new Date(Date.now() - USAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [usage, recent, running] = await Promise.all([
    context.models.queryLogs.getUsageByDatasource(datasource, since),
    context.models.queryLogs.getRecentByDatasource(datasource),
    getRunningQueriesByDatasource(context.org.id, datasource.id),
  ]);

  const experimentIds = new Set([
    ...usage.experiments.map((e) => e.id ?? ""),
    ...recent.map((q) => q.experimentId ?? ""),
  ]);
  experimentIds.delete("");
  const [experiments, factTables] = await Promise.all([
    getExperimentsByIds(context, [...experimentIds]),
    getFactTablesByIds(
      context,
      usage.factTables.flatMap((f) => (f.id ? [f.id] : [])),
    ),
  ]);

  res.status(200).json({
    status: 200,
    usage,
    recent,
    running,
    experimentNames: Object.fromEntries(experiments.map((e) => [e.id, e.name])),
    // Without a date filter, every query scans the whole table
    factTablesWithoutDateFilter: factTables
      .filter((f) => !/\{\{[^}]*startDate/.test(f.sql))
      .map((f) => f.id),
  });
};
