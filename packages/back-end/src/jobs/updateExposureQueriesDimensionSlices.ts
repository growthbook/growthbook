import Agenda, { Job } from "agenda";
import { subDays } from "date-fns";
import { logger } from "back-end/src/util/logger";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import {
  _dangerousGetAllDatasourcesWithExposureQueriesWithAutomaticDimensionSlices,
  getDataSourceById,
  updateDataSource,
} from "back-end/src/models/DataSourceModel";
import { usingFileConfig } from "back-end/src/init/config";
import { getIntegrationFromDatasourceId } from "back-end/src/services/datasource";
import {
  createDimensionSlices,
  _dangerousGetAllDimensionSlicesByIds,
} from "back-end/src/models/DimensionSlicesModel";
import { DimensionSlicesQueryRunner } from "back-end/src/queryRunners/DimensionSlicesQueryRunner";

const QUEUE_EXPOSURE_QUERIES_DIMENSION_SLICES_UPDATES =
  "queueExposureQueriesDimensionSlicesUpdates";

const UPDATE_SINGLE_DATASOURCE_EXPOSURE_QUERIES_DIMENSION_SLICES =
  "updateSingleExposureQueryDimensionSlices";

const DEFAULT_LOOKBACK_DAYS = 30;

type UpdateSingleJobParams = {
  organizationId: string;
  dataSourceId: string;
  exposureQueryIds: string[];
};

export default async function (agenda: Agenda) {
  agenda.define(QUEUE_EXPOSURE_QUERIES_DIMENSION_SLICES_UPDATES, async () => {
    const exposureQueriesToUpdate =
      await getDataSourcesWithExposureQueriesToUpdate();

    for (const jobParams of exposureQueriesToUpdate) {
      await queueExposureQueriesDimensionSlicesUpdate(jobParams);
    }
  });

  agenda.define(
    UPDATE_SINGLE_DATASOURCE_EXPOSURE_QUERIES_DIMENSION_SLICES,
    updateSingleDatasourceExposureQueriesDimensionSlices,
  );

  // Don't schedule automatic updates if using file config
  if (usingFileConfig()) return;

  await startUpdateJob();

  async function startUpdateJob() {
    const job = agenda.create(
      QUEUE_EXPOSURE_QUERIES_DIMENSION_SLICES_UPDATES,
      {},
    );
    job.unique({});
    job.repeatEvery("1 day");
    await job.save();
  }

  async function queueExposureQueriesDimensionSlicesUpdate(
    jobParams: UpdateSingleJobParams,
  ) {
    logger.info(
      {
        dataSourceId: jobParams.dataSourceId,
        exposureQueryIds: jobParams.exposureQueryIds,
      },
      "Queuing dimension slices update",
    );

    const job = agenda.create(
      UPDATE_SINGLE_DATASOURCE_EXPOSURE_QUERIES_DIMENSION_SLICES,
      jobParams,
    );
    job.unique({
      organizationId: jobParams.organizationId,
      dataSourceId: jobParams.dataSourceId,
    });
    job.schedule(new Date());
    await job.save();
  }
}

async function getDataSourcesWithExposureQueriesToUpdate(): Promise<
  UpdateSingleJobParams[]
> {
  try {
    const potentialDataSourcesToUpdate =
      await _dangerousGetAllDatasourcesWithExposureQueriesWithAutomaticDimensionSlices();

    // Include only exposure queries that have at least one non-custom slice
    const dataSourcesAndExposureQueries = potentialDataSourcesToUpdate
      .map((ds) => {
        const exposureQueries = ds.settings?.queries?.exposure || [];
        const queriesWithAutomaticDimensionSlices = exposureQueries.filter(
          (eq) => eq.dimensionMetadata?.some((m) => m.customSlices === false),
        );

        if (queriesWithAutomaticDimensionSlices.length > 0) {
          return {
            dataSource: ds,
            exposureQueries: queriesWithAutomaticDimensionSlices,
          };
        }
      })
      .filter((x) => x !== undefined);

    const existingDimensionSlicesIds = dataSourcesAndExposureQueries
      .flatMap((x) => x.exposureQueries.map((eq) => eq.dimensionSlicesId))
      .filter((id) => id !== undefined);

    const dimensionSlices = await _dangerousGetAllDimensionSlicesByIds(
      existingDimensionSlicesIds,
      subDays(new Date(), 7),
    );
    const dimensionSlicesMap = new Map(
      dimensionSlices.map((ds) => [ds.id, ds]),
    );

    // Filter exposure queries based on dimension slices criteria
    const dataSourcesAndExposureQueryIdsMap = dataSourcesAndExposureQueries
      .map(({ dataSource, exposureQueries }) => {
        const filteredExposureQueries = exposureQueries.filter((eq) => {
          // If the exposureQuery does not have a dimensionSlicesId defined, it should be included
          if (!eq.dimensionSlicesId) {
            return true;
          }

          // If it does have a dimensionSliceId but no dimensionSlice was returned from _dangerousGetAllDimensionSlicesByIds,
          // it should be skipped as the Date filter makes it ineligible for the automatic update
          return dimensionSlicesMap.has(eq.dimensionSlicesId);
        });

        // If we filter out all exposureQueries for a given data source then we should also not even return the data source
        if (filteredExposureQueries.length === 0) {
          return null;
        }

        return {
          organizationId: dataSource.organization,
          dataSourceId: dataSource.id,
          exposureQueryIds: filteredExposureQueries.map((eq) => eq.id),
        };
      })
      .filter((x) => x !== null);

    return dataSourcesAndExposureQueryIdsMap;
  } catch (e) {
    // Silently fail as this is not critical -- but log it so we can fix it
    logger.error(e, "Failed to queue dimension slices updates");
    return [];
  }
}

const updateSingleDatasourceExposureQueriesDimensionSlices = async (
  job: Job<{
    organizationId: string;
    dataSourceId: string;
    exposureQueryIds: string[];
  }>,
) => {
  const organizationId = job.attrs.data?.organizationId;
  const dataSourceId = job.attrs.data?.dataSourceId;
  const exposureQueryIds = job.attrs.data?.exposureQueryIds;

  if (
    !organizationId ||
    !dataSourceId ||
    !exposureQueryIds ||
    !exposureQueryIds.length
  ) {
    logger.warn(
      {
        organizationId,
        dataSourceId,
        exposureQueryIds,
      },
      "Invalid job parameters for dimension slices update",
    );
    return;
  }

  const context = await getContextForAgendaJobByOrgId(organizationId);
  const dataSource = await getDataSourceById(context, dataSourceId);
  if (!dataSource) {
    logger.warn(
      `Data source ${dataSourceId} not found for dimension slices update`,
      {
        organizationId,
        dataSourceId,
      },
    );
    return;
  }

  const integration = await getIntegrationFromDatasourceId(
    context,
    dataSourceId,
    true,
  );

  // We need to keep track of all queries, even the ones we are not changing, so we can update the data source
  const allExposureQueries = new Map(
    dataSource.settings.queries?.exposure?.map((q) => [q.id, { ...q }]),
  );

  for (const queryId of exposureQueryIds) {
    const exposureQuery = allExposureQueries.get(queryId);
    if (!exposureQuery) {
      logger.warn(
        {
          organizationId,
          dataSourceId,
          exposureQueryId: queryId,
        },
        `Exposure query not found in data source`,
      );
      continue;
    }

    const model = await createDimensionSlices({
      organization: organizationId,
      dataSourceId,
      queryId,
    });

    const queryRunner = new DimensionSlicesQueryRunner(
      context,
      model,
      integration,
    );

    queryRunner.startAnalysis({
      exposureQueryId: queryId,
      lookbackDays: DEFAULT_LOOKBACK_DAYS,
    });

    await queryRunner.waitForResults();
    const outputModel = queryRunner.model;

    exposureQuery.dimensionSlicesId = outputModel.id;
    exposureQuery.dimensionMetadata = exposureQuery.dimensions.map((d) => ({
      dimension: d,
      specifiedSlices:
        outputModel.results
          .find((r) => r.dimension === d)
          ?.dimensionSlices.map((s) => s.name) ?? [],
      customSlices: false,
    }));

    allExposureQueries.set(queryId, exposureQuery);
  }

  await updateDataSource(context, dataSource, {
    ...dataSource,
    settings: {
      ...dataSource.settings,
      queries: {
        ...dataSource.settings.queries,
        exposure: Array.from(allExposureQueries.values()),
      },
    },
  });
};
