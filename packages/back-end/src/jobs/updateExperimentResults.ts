import Agenda, { Job } from "agenda";
import { getScopedSettings } from "shared/settings";
import {
  getExperimentById,
  getExperimentsToUpdate,
  getExperimentsToUpdateLegacy,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
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
import { notifyAutoUpdate } from "back-end/src/services/experimentNotifications";
import { EXPERIMENT_REFRESH_FREQUENCY } from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";
import { getFactTableMap } from "back-end/src/models/FactTableModel";

// Time between experiment result updates (default 6 hours)
const UPDATE_EVERY = EXPERIMENT_REFRESH_FREQUENCY * 60 * 60 * 1000;

const QUEUE_EXPERIMENT_UPDATES = "queueExperimentUpdates";

const UPDATE_SINGLE_EXP = "updateSingleExperiment";
type UpdateSingleExpJob = Job<{
  organization: string;
  experimentId: string;
}>;

export default async function (agenda: Agenda) {
  agenda.define(QUEUE_EXPERIMENT_UPDATES, async () => {
    // Old way of queuing experiments based on a fixed schedule
    // Will remove in the future when it's no longer needed
    const ids = await legacyQueueExperimentUpdates();

    // New way, based on dynamic schedules
    const experiments = await getExperimentsToUpdate(ids);

    for (let i = 0; i < experiments.length; i++) {
      await queueExperimentUpdate(
        experiments[i].organization,
        experiments[i].id,
      );
    }
  });

  agenda.define(UPDATE_SINGLE_EXP, updateSingleExperiment);

  // Update experiment results
  await startUpdateJob();

  async function legacyQueueExperimentUpdates() {
    // All experiments that haven't been updated in at least UPDATE_EVERY ms
    const latestDate = new Date(Date.now() - UPDATE_EVERY);

    const experiments = await getExperimentsToUpdateLegacy(latestDate);

    for (let i = 0; i < experiments.length; i++) {
      await queueExperimentUpdate(
        experiments[i].organization,
        experiments[i].id,
      );
    }

    return experiments.map((e) => e.id);
  }

  async function startUpdateJob() {
    const updateResultsJob = agenda.create(QUEUE_EXPERIMENT_UPDATES, {});
    updateResultsJob.unique({});
    updateResultsJob.repeatEvery("10 minutes");
    await updateResultsJob.save();
  }

  async function queueExperimentUpdate(
    organization: string,
    experimentId: string,
  ) {
    const job = agenda.create(UPDATE_SINGLE_EXP, {
      organization,
      experimentId,
    }) as UpdateSingleExpJob;

    job.unique({
      experimentId,
      organization,
    });
    job.schedule(new Date());
    await job.save();
  }
}

const updateSingleExperiment = async (job: UpdateSingleExpJob) => {
  const experimentId = job.attrs.data?.experimentId;
  const orgId = job.attrs.data?.organization;

  if (!experimentId || !orgId) return;

  const context = await getContextForAgendaJobByOrgId(orgId);

  const { org: organization } = context;

  const experiment = await getExperimentById(context, experimentId);
  if (!experiment) return;

  let project = null;
  if (experiment.project) {
    project = await context.models.projects.getById(experiment.project);
  }
  const { settings: scopedSettings } = getScopedSettings({
    organization: context.org,
    project: project ?? undefined,
  });

  // Disable auto snapshots for the experiment so it doesn't keep trying to update if schedule is off (non-bandits only)
  if (
    organization?.settings?.updateSchedule?.type === "never" &&
    experiment.type !== "multi-armed-bandit"
  ) {
    await updateExperiment({
      context,
      experiment,
      changes: {
        autoSnapshots: false,
      },
    });
    return;
  }

  try {
    logger.info("Start Refreshing Results for experiment " + experimentId);
    const datasource = await getDataSourceById(
      context,
      experiment.datasource || "",
    );
    if (!datasource) {
      throw new Error("Error refreshing experiment, could not find datasource");
    }

    const { regressionAdjustmentEnabled, settingsForSnapshotMetrics } =
      await getSettingsForSnapshotMetrics(context, experiment);

    const analysisSettings = getDefaultExperimentAnalysisSettings(
      experiment.statsEngine || scopedSettings.statsEngine.value,
      experiment,
      organization,
      regressionAdjustmentEnabled,
    );

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

    const phaseIndex = experiment.phases.length - 1;

    const queryRunner = await createSnapshot({
      experiment,
      context,
      phaseIndex,
      defaultAnalysisSettings: analysisSettings,
      additionalAnalysisSettings:
        getAdditionalExperimentAnalysisSettings(analysisSettings),
      settingsForSnapshotMetrics: settingsForSnapshotMetrics || [],
      metricMap,
      factTableMap,
      useCache: true,
      type: "standard",
      triggeredBy: "schedule",
      reweight,
    });
    await queryRunner.waitForResults();
    const currentSnapshot = queryRunner.model;

    logger.info(
      "Successfully Refreshed Results for experiment " + experimentId,
    );

    if (experiment.type === "multi-armed-bandit") {
      const changes = updateExperimentBanditSettings({
        experiment,
        snapshot: currentSnapshot,
        reweight:
          currentSnapshot?.banditResult?.reweight &&
          experiment.banditStage === "exploit",
        isScheduled: true,
      });
      await updateExperiment({
        context,
        experiment,
        changes,
      });
    }
  } catch (e) {
    logger.error(e, "Failed to update experiment: " + experimentId);
    // If we failed to update the experiment, turn off auto-updating for the future (non-bandits only)
    if (experiment.type === "multi-armed-bandit") return;
    try {
      await updateExperiment({
        context,
        experiment,
        changes: {
          autoSnapshots: false,
        },
      });

      await notifyAutoUpdate({ context, experiment, success: true });
    } catch (e) {
      logger.error(e, "Failed to turn off autoSnapshots: " + experimentId);
      await notifyAutoUpdate({ context, experiment, success: false });
    }
  }
};