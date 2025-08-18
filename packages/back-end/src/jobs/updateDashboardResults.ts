import Agenda, { Job } from "agenda";
import { getScopedSettings } from "shared/settings";
import {
  blockHasFieldOfType,
  BlockSnapshotSettings,
  getBlockAnalysisSettings,
  getBlockSnapshotSettings,
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
  updateExperimentBanditSettings,
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
    dashboardId: string
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

  const { settings: scopedSettings } = getScopedSettings({
    organization: context.org,
    project: undefined,
  });

  try {
    logger.info("Start Refreshing Results for dashboard " + dashboardId);

    const blocksByExperiment = groupBy(
      dashboard.blocks.filter((block) =>
        blockHasFieldOfType(block, "experimentId", isString)
      ),
      (block) => block.experimentId
    );
    for (const [experimentId, blocks] of Object.entries(blocksByExperiment)) {
      const blocksWithSnapshots = blocks.filter((block) =>
        blockHasFieldOfType(block, "snapshotId", isString)
      );
      if (blocksWithSnapshots.length === 0) return;
      const snapshotIds = new Set(
        blocksWithSnapshots.map((block) => block.snapshotId)
      );
      const snapshots = Object.fromEntries(
        await Promise.all(
          [...snapshotIds].map<Promise<[string, ExperimentSnapshotInterface]>>(
            async (snapshotId) => {
              const snapshot = await findSnapshotById(orgId, snapshotId);
              if (!snapshot) {
                // TODO: handle error better?
                throw new Error(
                  "Error refreshing dashboard, could not find snapshot"
                );
              }
              return [snapshotId, snapshot];
            }
          )
        )
      );
      const experiment = await getExperimentById(context, experimentId);
      if (!experiment) {
        throw new Error(
          "Error refreshing dashboard, could not find experiment"
        );
      }
      const datasource = await getDataSourceById(
        context,
        experiment.datasource || ""
      );
      if (!datasource) {
        throw new Error(
          "Error refreshing dashboard, could not find datasource"
        );
      }

      const {
        regressionAdjustmentEnabled,
        settingsForSnapshotMetrics,
      } = await getSettingsForSnapshotMetrics(context, experiment);

      const metricMap = await getMetricMap(context);
      const factTableMap = await getFactTableMap(context);

      let reweight =
        experiment.type === "multi-armed-bandit" &&
        experiment.banditStage === "exploit";

      if (experiment.type === "multi-armed-bandit" && !reweight) {
        // Quick check to see if we're about to enter "exploit" stage and will need to reweight
        const tempChanges = updateExperimentBanditSettings({
          experiment,
          isScheduled: true,
        });
        if (tempChanges.banditStage === "exploit") {
          reweight = true;
        }
      }

      const snapshotAndAnalysisSettings = blocksWithSnapshots.map<
        [BlockSnapshotSettings, ExperimentSnapshotAnalysisSettings]
      >((block) => {
        return [
          getBlockSnapshotSettings(block),
          // TODO: validate that analyses[0] exists
          getBlockAnalysisSettings(
            block,
            snapshots[block.snapshotId].analyses[0].settings
          ),
        ];
      });

      const uniqueSnapshotSettings = uniqWith<BlockSnapshotSettings>(
        snapshotAndAnalysisSettings.map(
          ([snapshotSettings]) => snapshotSettings
        ),
        isEqual
      );

      for (const snapshotSettings of uniqueSnapshotSettings) {
        const additionalAnalysisSettings = uniqWith<ExperimentSnapshotAnalysisSettings>(
          snapshotAndAnalysisSettings
            .filter(([targetSettings]) =>
              isEqual(snapshotSettings, targetSettings)
            )
            .map(([_, analysisSettings]) => analysisSettings),
          isEqual
        );

        const analysisSettings = getDefaultExperimentAnalysisSettings(
          experiment.statsEngine || scopedSettings.statsEngine.value,
          experiment,
          organization,
          regressionAdjustmentEnabled,
          snapshotSettings.dimensionId
        );

        const queryRunner = await createSnapshot({
          experiment,
          context,
          phaseIndex: experiment.phases.length - 1,
          defaultAnalysisSettings: analysisSettings,
          additionalAnalysisSettings: getAdditionalExperimentAnalysisSettings(
            analysisSettings
          ).concat(additionalAnalysisSettings),
          settingsForSnapshotMetrics: settingsForSnapshotMetrics || [],
          metricMap,
          factTableMap,
          useCache: true,
          type: "standard",
          triggeredBy: "schedule",
          reweight,
        });
        await queryRunner.waitForResults();
      }
    }

    const blocksWithSavedQueries = dashboard.blocks.filter((block) =>
      blockHasFieldOfType(block, "savedQueryId", isString)
    );
    await Promise.all(
      blocksWithSavedQueries.map(async ({ savedQueryId }) => {
        const savedQuery = await context.models.savedQueries.getById(
          savedQueryId
        );
        if (!savedQuery) {
          throw new Error(
            "Error refreshing dashboard, could not find saved query"
          );
        }
        const datasource = await getDataSourceById(
          context,
          savedQuery.datasourceId
        );
        if (datasource) {
          executeAndSaveQuery(context, savedQuery, datasource);
        }
      })
    );

    logger.info("Successfully Refreshed Results for dashboard " + dashboardId);
    // TODO: set next update?
  } catch (e) {
    logger.error(e, "Failed to update dashboard: " + dashboardId);
    // If we failed to update the dashboard, turn off auto-updating for the future
    try {
      await context.models.dashboards.dangerousUpdateBypassPermission(
        dashboard,
        {
          enableAutoUpdates: false,
        }
      );

      // await notifyAutoUpdate({ context, experiment, success: true });
    } catch (e) {
      // logger.error(e, "Failed to turn off autoSnapshots: " + experimentId);
      // await notifyAutoUpdate({ context, experiment, success: false });
    }
  }
};
