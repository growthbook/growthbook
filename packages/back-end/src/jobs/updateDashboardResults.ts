import Agenda, { Job } from "agenda";
import { getScopedSettings } from "shared/settings";
import {
  blockHasFieldOfType,
  BlockSnapshotSettings,
  getBlockAnalysisSettings,
  getBlockSnapshotSettings,
  snapshotSatisfiesBlock,
} from "shared/enterprise";
import { isString } from "shared/util";
import { groupBy, isEqual, uniqWith } from "lodash";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  createSnapshot,
  getAdditionalExperimentAnalysisSettings,
  getDefaultExperimentAnalysisSettings,
  getSettingsForSnapshotMetrics,
} from "back-end/src/services/experiments";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { logger } from "back-end/src/util/logger";
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "back-end/types/experiment-snapshot";
import { DashboardModel } from "../enterprise/models/DashboardModel";
import { findSnapshotById } from "../models/ExperimentSnapshotModel";
import { executeAndSaveQuery } from "../routers/saved-queries/saved-queries.controller";

const QUEUE_DASHBOARD_UPDATES = "queueDashboardUpdates";

const UPDATE_SINGLE_DASH = "updateSingleDashboard";
type UpdateSingleDashJob = Job<{
  organization: string;
  dashboardId: string;
}>;

export default async function (agenda: Agenda) {
  agenda.define(QUEUE_DASHBOARD_UPDATES, async () => {
    const dashboards = await DashboardModel.getDashboardsToUpdate();
    for (let i = 0; i < dashboards.length; i++) {
      await queueDashboardUpdate(dashboards[i].organization, dashboards[i].id);
    }
  });

  agenda.define(UPDATE_SINGLE_DASH, updateSingleDashboard);

  await startUpdateJob();

  async function startUpdateJob() {
    const updateResultsJob = agenda.create(QUEUE_DASHBOARD_UPDATES, {});
    updateResultsJob.unique({});
    updateResultsJob.repeatEvery("10 minutes");
    await updateResultsJob.save();
  }

  async function queueDashboardUpdate(
    organization: string,
    dashboardId: string,
  ) {
    const job = agenda.create(UPDATE_SINGLE_DASH, {
      organization,
      dashboardId,
    }) as UpdateSingleDashJob;

    job.unique({
      dashboardId,
      organization,
    });
    job.schedule(new Date());
    await job.save();
  }
}

const updateSingleDashboard = async (job: UpdateSingleDashJob) => {
  const dashboardId = job.attrs.data?.dashboardId;
  const orgId = job.attrs.data?.organization;

  if (!dashboardId || !orgId) return;

  const context = await getContextForAgendaJobByOrgId(orgId);

  const { org: organization } = context;

  const dashboard = await context.models.dashboards.getById(dashboardId);
  if (!dashboard) return;

  try {
    logger.info("Start Refreshing Results for dashboard " + dashboardId);

    // We can disable auto-updates if the dashboard isn't linked to at least one running experiment
    // or sql explorer saved query
    let continueRunningUpdates = false;

    const blocksByExperiment = groupBy(
      dashboard.blocks.filter((block) =>
        blockHasFieldOfType(block, "experimentId", isString),
      ),
      (block) => block.experimentId,
    );
    for (const [experimentId, blocks] of Object.entries(blocksByExperiment)) {
      if (experimentId.length === 0) continue;
      const blocksWithSnapshots = blocks.filter((block) =>
        blockHasFieldOfType(block, "snapshotId", isString),
      );
      if (blocksWithSnapshots.length === 0) continue;
      const experiment = await getExperimentById(context, experimentId);
      if (!experiment) {
        throw new Error(
          "Error refreshing dashboard, could not find experiment",
        );
      }
      if (experiment.status === "running") continueRunningUpdates = true;
      const datasource = await getDataSourceById(
        context,
        experiment.datasource || "",
      );
      if (!datasource) {
        throw new Error(
          "Error refreshing dashboard, could not find datasource",
        );
      }

      let project = null;
      if (experiment.project) {
        project = await context.models.projects.getById(experiment.project);
      }
      const { settings: scopedSettings } = getScopedSettings({
        organization: context.org,
        project: project ?? undefined,
      });

      const { regressionAdjustmentEnabled, settingsForSnapshotMetrics } =
        await getSettingsForSnapshotMetrics(context, experiment);

      const metricMap = await getMetricMap(context);
      const factTableMap = await getFactTableMap(context);

      const mainAnalysisSettings = getDefaultExperimentAnalysisSettings(
        experiment.statsEngine || scopedSettings.statsEngine.value,
        experiment,
        organization,
        regressionAdjustmentEnabled,
      );

      const mainQueryRunner = await createSnapshot({
        experiment,
        context,
        phaseIndex: experiment.phases.length - 1,
        defaultAnalysisSettings: mainAnalysisSettings,
        additionalAnalysisSettings:
          getAdditionalExperimentAnalysisSettings(mainAnalysisSettings),
        settingsForSnapshotMetrics: settingsForSnapshotMetrics || [],
        metricMap,
        factTableMap,
        // TODO: make sure that the cache is effective if multiple dashboards are refreshing at the same time
        // since we don't want to re-run the same queries for a single experiment
        useCache: true,
        type: "dashboard",
        dashboardId,
        triggeredBy: "schedule",
      });
      await mainQueryRunner.waitForResults();
      const mainSnapshot = mainQueryRunner.model;

      const blocksNeedingSnapshot = blocksWithSnapshots.filter(
        (block) => !snapshotSatisfiesBlock(mainSnapshot, block),
      );
      const snapshotIds = new Set(
        blocksNeedingSnapshot.map((block) => block.snapshotId),
      );
      const snapshots = Object.fromEntries(
        await Promise.all(
          [...snapshotIds].map<Promise<[string, ExperimentSnapshotInterface]>>(
            async (snapshotId) => {
              const snapshot = await findSnapshotById(orgId, snapshotId);
              if (!snapshot) {
                // TODO: handle error better?
                throw new Error(
                  "Error refreshing dashboard, could not find snapshot",
                );
              }
              return [snapshotId, snapshot];
            },
          ),
        ),
      );

      const snapshotAndAnalysisSettings = blocksNeedingSnapshot.map<
        [BlockSnapshotSettings, ExperimentSnapshotAnalysisSettings]
      >((block) => {
        return [
          getBlockSnapshotSettings(block),
          // TODO: validate that analyses[0] exists
          getBlockAnalysisSettings(
            block,
            snapshots[block.snapshotId].analyses[0].settings,
          ),
        ];
      });

      const uniqueSnapshotSettings = uniqWith<BlockSnapshotSettings>(
        snapshotAndAnalysisSettings.map(
          ([snapshotSettings]) => snapshotSettings,
        ),
        isEqual,
      );

      for (const snapshotSettings of uniqueSnapshotSettings) {
        const additionalAnalysisSettings =
          uniqWith<ExperimentSnapshotAnalysisSettings>(
            snapshotAndAnalysisSettings
              .filter(([targetSettings]) =>
                isEqual(snapshotSettings, targetSettings),
              )
              .map(([_, analysisSettings]) => analysisSettings),
            isEqual,
          );

        const analysisSettings = getDefaultExperimentAnalysisSettings(
          experiment.statsEngine || scopedSettings.statsEngine.value,
          experiment,
          organization,
          regressionAdjustmentEnabled,
          snapshotSettings.dimensionId,
        );

        const queryRunner = await createSnapshot({
          experiment,
          context,
          phaseIndex: experiment.phases.length - 1,
          defaultAnalysisSettings: analysisSettings,
          additionalAnalysisSettings: getAdditionalExperimentAnalysisSettings(
            analysisSettings,
          ).concat(additionalAnalysisSettings),
          settingsForSnapshotMetrics: settingsForSnapshotMetrics || [],
          metricMap,
          factTableMap,
          useCache: true,
          type: "dashboard",
          dashboardId,
          triggeredBy: "schedule",
        });
        await queryRunner.waitForResults();
      }
    }

    const blocksWithSavedQueries = dashboard.blocks.filter((block) =>
      blockHasFieldOfType(block, "savedQueryId", isString),
    );
    if (blocksWithSavedQueries.length > 0) continueRunningUpdates = true;
    await Promise.all(
      blocksWithSavedQueries.map(async ({ savedQueryId }) => {
        if (savedQueryId.length === 0) return;
        const savedQuery =
          await context.models.savedQueries.getById(savedQueryId);
        if (!savedQuery) {
          throw new Error(
            "Error refreshing dashboard, could not find saved query",
          );
        }
        const datasource = await getDataSourceById(
          context,
          savedQuery.datasourceId,
        );
        if (datasource) {
          executeAndSaveQuery(context, savedQuery, datasource);
        }
      }),
    );

    if (!continueRunningUpdates) {
      await context.models.dashboards.dangerousUpdateBypassPermission(
        dashboard,
        {
          enableAutoUpdates: false,
          nextUpdate: undefined,
        },
      );
    }
    logger.info("Successfully Refreshed Results for dashboard " + dashboardId);
  } catch (e) {
    logger.error(e, "Failed to update dashboard: " + dashboardId);
    // If we failed to update the dashboard, turn off auto-updating for the future
    try {
      await context.models.dashboards.dangerousUpdateBypassPermission(
        dashboard,
        {
          enableAutoUpdates: false,
          nextUpdate: undefined,
        },
      );
    } catch (e) {
      logger.error(e, "Failed to turn off autoSnapshots: " + dashboardId);
    }
  }
};
