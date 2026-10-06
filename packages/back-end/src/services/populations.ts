import {
  PopulationInterface,
  PopulationSnapshotInterface,
} from "shared/validators";
import {
  getPopulationFactTableIds,
  POPULATION_COMPARISON_DAYS,
} from "shared/populations";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getFactTablesByIds } from "back-end/src/models/FactTableModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import SqlIntegration from "back-end/src/integrations/SqlIntegration";
import { PopulationSnapshotQueryRunner } from "back-end/src/queryRunners/PopulationSnapshotQueryRunner";

async function getPopulationIntegration(
  context: ReqContext | ApiReqContext,
  population: PopulationInterface,
): Promise<SqlIntegration> {
  const datasource = await getDataSourceById(context, population.datasource);
  if (!datasource) {
    return context.throwBadRequestError(
      `Data Source ${population.datasource} not found.`,
    );
  }
  const integration = getSourceIntegrationObject(context, datasource, true);
  if (!(integration instanceof SqlIntegration)) {
    return context.throwBadRequestError(
      "Populations only support SQL Data Sources.",
    );
  }
  return integration;
}

// Returns the snapshot already running, if there is one, rather than starting
// a duplicate warehouse query.
export async function refreshPopulation(
  context: ReqContext | ApiReqContext,
  population: PopulationInterface,
): Promise<PopulationSnapshotInterface> {
  const latest =
    await context.models.populationSnapshots.getLatestForPopulation(
      population.id,
    );
  if (latest?.status === "running") return latest;

  const integration = await getPopulationIntegration(context, population);
  if (!context.permissions.canRunFactQueries(integration.datasource)) {
    context.permissions.throwPermissionError();
  }

  const factTables = await getFactTablesByIds(
    context,
    getPopulationFactTableIds(population.steps),
  );

  const snapshot = await context.models.populationSnapshots.create({
    population: population.id,
    userIdType: population.userIdTypes[0],
    asOf: new Date(),
    comparisonDays: POPULATION_COMPARISON_DAYS,
    status: "running",
    queries: [],
    runStarted: null,
    result: null,
  });

  const runner = new PopulationSnapshotQueryRunner(
    context,
    snapshot,
    integration,
    false,
  );
  return runner.startAnalysis({
    population,
    factTableMap: new Map(factTables.map((f) => [f.id, f])),
  });
}

export async function cancelPopulationRefresh(
  context: ReqContext | ApiReqContext,
  population: PopulationInterface,
): Promise<boolean> {
  const latest =
    await context.models.populationSnapshots.getLatestForPopulation(
      population.id,
    );
  if (!latest || latest.status !== "running") return false;

  const integration = await getPopulationIntegration(context, population);
  const runner = new PopulationSnapshotQueryRunner(
    context,
    latest,
    integration,
    false,
  );
  await runner.cancelQueries();
  await context.models.populationSnapshots.delete(latest);
  return true;
}
