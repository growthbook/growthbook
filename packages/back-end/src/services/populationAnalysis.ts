import {
  ApiPopulationAnalysis,
  PopulationAnalysisInterface,
  PopulationInterface,
} from "shared/validators";
import { getPopulationFactTableIds } from "shared/populations";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getFactTablesByIds } from "back-end/src/models/FactTableModel";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import SqlIntegration from "back-end/src/integrations/SqlIntegration";
import { getPopulationMembershipAsOf } from "back-end/src/integrations/sql/dates/population-membership-points";
import { isPopulationSupportedDatasourceType } from "back-end/src/integrations/sql/queries/population-membership-query";
import { PopulationAnalysisQueryRunner } from "back-end/src/queryRunners/PopulationAnalysisQueryRunner";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";

// Longest a refresh request waits for the queries before returning the
// analysis as still running, matching product analytics explorations.
const POPULATION_ANALYSIS_SYNC_TIMEOUT_MS = 5000;

export function toApiPopulationAnalysis(
  doc: PopulationAnalysisInterface,
): ApiPopulationAnalysis {
  return {
    id: doc.id,
    dateCreated: doc.dateCreated.toISOString(),
    dateUpdated: doc.dateUpdated.toISOString(),
    population: doc.population,
    datasource: doc.datasource,
    userIdType: doc.userIdType,
    steps: doc.steps,
    asOf: doc.asOf.toISOString(),
    status: doc.status,
    error: doc.error,
    queries: doc.queries.map((q) => q.query),
    result: doc.result,
  };
}

async function getReadablePopulation(
  context: ReqContext | ApiReqContext,
  id: string,
): Promise<PopulationInterface> {
  const population = await context.models.populations.getById(id);
  if (!population) {
    throw new NotFoundError(`Population ${id} not found or not accessible`);
  }
  return population;
}

export async function getLatestPopulationAnalysis(
  context: ReqContext | ApiReqContext,
  populationId: string,
): Promise<ApiPopulationAnalysis | null> {
  const population = await getReadablePopulation(context, populationId);
  const analysis =
    await context.models.populationAnalyses.findLatestByPopulation(
      population.id,
    );
  return analysis ? toApiPopulationAnalysis(analysis) : null;
}

export async function refreshPopulationAnalysis(
  context: ReqContext | ApiReqContext,
  populationId: string,
): Promise<ApiPopulationAnalysis> {
  const population = await getReadablePopulation(context, populationId);

  const datasource = await getDataSourceById(context, population.datasource);
  if (!datasource) {
    throw new NotFoundError(`Data Source ${population.datasource} not found`);
  }
  if (!context.permissions.canRunFactQueries(datasource)) {
    context.permissions.throwPermissionError();
  }
  if (!isPopulationSupportedDatasourceType(datasource.type)) {
    throw new BadRequestError(
      "Population membership isn't supported for this data source yet.",
    );
  }

  const integration = getSourceIntegrationObject(context, datasource, true);
  if (!(integration instanceof SqlIntegration)) {
    throw new BadRequestError("Populations only support SQL data sources");
  }

  const factTables = await getFactTablesByIds(
    context,
    getPopulationFactTableIds(population.steps),
  );

  const analysis = await context.models.populationAnalyses.create({
    population: population.id,
    datasource: datasource.id,
    // TODO: Let the caller choose once the detail page can switch identifier types.
    userIdType: population.userIdTypes[0],
    steps: population.steps,
    asOf: getPopulationMembershipAsOf(),
    status: "running",
    error: null,
    runStarted: null,
    queries: [],
    result: null,
  });

  const queryRunner = new PopulationAnalysisQueryRunner(
    context,
    analysis,
    integration,
  );

  // The runner keeps driving the queries after the timeout and saves its
  // progress, so the caller polls getPopulationAnalysis for the result.
  let syncTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await queryRunner.startAnalysis({
      factTableMap: new Map(factTables.map((f) => [f.id, f])),
    });
    await Promise.race([
      queryRunner.waitForResults().catch(() => {}),
      new Promise<void>((resolve) => {
        syncTimer = setTimeout(resolve, POPULATION_ANALYSIS_SYNC_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // Failures are saved on the analysis, which is returned below.
  } finally {
    if (syncTimer) clearTimeout(syncTimer);
  }

  const latest = await context.models.populationAnalyses.getById(analysis.id);
  return toApiPopulationAnalysis(latest ?? queryRunner.model);
}
