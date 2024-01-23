import Agenda, { Job } from "agenda";
import { getScopedSettings } from "shared/settings";
import { getSnapshotAnalysis } from "shared/util";
import {
  getExperimentById,
  getExperimentsToUpdate,
  getExperimentsToUpdateLegacy,
  updateExperiment,
} from "../models/ExperimentModel";
import { getDataSourceById } from "../models/DataSourceModel";
import { isEmailEnabled, sendExperimentChangesEmail } from "../services/email";
import {
  createSnapshot,
  getAdditionalExperimentAnalysisSettings,
  getDefaultExperimentAnalysisSettings,
  getExperimentMetricById,
  getRegressionAdjustmentInfo,
} from "../services/experiments";
import {
  getConfidenceLevelsForOrg,
  getContextForAgendaJobByOrgId,
} from "../services/organizations";
import { getLatestSnapshot } from "../models/ExperimentSnapshotModel";
import { ExperimentInterface } from "../../types/experiment";
import { getMetricMap } from "../models/MetricModel";
import { EXPERIMENT_REFRESH_FREQUENCY } from "../util/secrets";
import { findOrganizationById } from "../models/OrganizationModel";
import { logger } from "../util/logger";
import { ExperimentSnapshotInterface } from "../../types/experiment-snapshot";
import { findProjectById } from "../models/ProjectModel";
import { getExperimentWatchers } from "../models/WatchModel";
import { getFactTableMap } from "../models/FactTableModel";

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
        experiments[i].id
      );
    }
  });

  agenda.define(
    UPDATE_SINGLE_EXP,
    // This job queries a datasource, which may be slow. Give it 30 minutes to complete.
    { lockLifetime: 30 * 60 * 1000 },
    updateSingleExperiment
  );

  // Update experiment results
  await startUpdateJob();

  async function legacyQueueExperimentUpdates() {
    // All experiments that haven't been updated in at least UPDATE_EVERY ms
    const latestDate = new Date(Date.now() - UPDATE_EVERY);

    const experiments = await getExperimentsToUpdateLegacy(latestDate);

    for (let i = 0; i < experiments.length; i++) {
      await queueExperimentUpdate(
        experiments[i].organization,
        experiments[i].id
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
    experimentId: string
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

async function updateSingleExperiment(job: UpdateSingleExpJob) {
  const experimentId = job.attrs.data?.experimentId;
  const orgId = job.attrs.data?.organization;

  if (!experimentId || !orgId) return;

  const experiment = await getExperimentById(orgId, experimentId);
  if (!experiment) return;

  const organization = await findOrganizationById(experiment.organization);
  if (!organization) return;

  const context = await getContextForAgendaJobByOrgId(orgId);

  let project = null;
  if (experiment.project) {
    project = await findProjectById(context, experiment.project);
  }
  const { settings: scopedSettings } = getScopedSettings({
    organization,
    project: project ?? undefined,
  });

  if (organization?.settings?.updateSchedule?.type === "never") return;

  try {
    logger.info("Start Refreshing Results for experiment " + experimentId);
    const datasource = await getDataSourceById(
      experiment.datasource || "",
      experiment.organization
    );
    if (!datasource) {
      throw new Error("Error refreshing experiment, could not find datasource");
    }
    const lastSnapshot = await getLatestSnapshot(
      experiment.id,
      experiment.phases.length - 1
    );

    const {
      regressionAdjustmentEnabled,
      metricRegressionAdjustmentStatuses,
    } = await getRegressionAdjustmentInfo(experiment, organization);

    const analysisSettings = getDefaultExperimentAnalysisSettings(
      experiment.statsEngine || scopedSettings.statsEngine.value,
      experiment,
      organization,
      regressionAdjustmentEnabled
    );

    const metricMap = await getMetricMap(organization.id);
    const factTableMap = await getFactTableMap(organization.id);

    const queryRunner = await createSnapshot({
      experiment,
      context,
      phaseIndex: experiment.phases.length - 1,
      defaultAnalysisSettings: analysisSettings,
      additionalAnalysisSettings: getAdditionalExperimentAnalysisSettings(
        analysisSettings,
        experiment
      ),
      metricRegressionAdjustmentStatuses:
        metricRegressionAdjustmentStatuses || [],
      metricMap,
      factTableMap,
      useCache: true,
    });
    await queryRunner.waitForResults();
    const currentSnapshot = queryRunner.model;

    logger.info(
      "Successfully Refreshed Results for experiment " + experimentId
    );

    if (lastSnapshot) {
      await sendSignificanceEmail(experiment, lastSnapshot, currentSnapshot);
    }
  } catch (e) {
    logger.error(e, "Failed to update experiment: " + experimentId);
    // If we failed to update the experiment, turn off auto-updating for the future
    try {
      await updateExperiment({
        context,
        experiment,
        user: null,
        changes: {
          autoSnapshots: false,
        },
      });
      // TODO: email user and let them know it failed
    } catch (e) {
      logger.error(e, "Failed to turn off autoSnapshots: " + experimentId);
    }
  }
}

async function sendSignificanceEmail(
  experiment: ExperimentInterface,
  lastSnapshot: ExperimentSnapshotInterface,
  currentSnapshot: ExperimentSnapshotInterface
) {
  // If email is not configured, there's nothing else to do
  if (!isEmailEnabled()) {
    return;
  }

  const currentVariations = getSnapshotAnalysis(currentSnapshot)?.results?.[0]
    ?.variations;
  const lastVariations = getSnapshotAnalysis(lastSnapshot)?.results?.[0]
    ?.variations;

  if (!currentVariations || !lastVariations) {
    return;
  }

  try {
    // get the org confidence level settings:
    const { ciUpper, ciLower } = await getConfidenceLevelsForOrg(
      experiment.organization
    );

    // check this and the previous snapshot to see if anything changed:
    const experimentChanges: string[] = [];
    for (let i = 1; i < currentVariations.length; i++) {
      const curVar = currentVariations[i];
      const lastVar = lastVariations[i];

      for (const m in curVar.metrics) {
        const curMetric = curVar?.metrics?.[m];
        const lastMetric = lastVar?.metrics?.[m];

        // sanity checks:
        if (
          lastMetric?.chanceToWin &&
          curMetric?.chanceToWin &&
          curMetric?.value > 150
        ) {
          // checks to see if anything changed:
          if (
            curMetric.chanceToWin > ciUpper &&
            lastMetric.chanceToWin < ciUpper
          ) {
            // this test variation has gone significant, and won
            experimentChanges.push(
              "The metric " +
                (await getExperimentMetricById(m, experiment.organization))
                  ?.name +
                " for variation " +
                experiment.variations[i].name +
                " has reached a " +
                (curMetric.chanceToWin * 100).toFixed(1) +
                "% chance to beat baseline"
            );
          } else if (
            curMetric.chanceToWin < ciLower &&
            lastMetric.chanceToWin > ciLower
          ) {
            // this test variation has gone significant, and lost
            experimentChanges.push(
              "The metric " +
                (await getExperimentMetricById(m, experiment.organization))
                  ?.name +
                " for variation " +
                experiment.variations[i].name +
                " has dropped to a " +
                (curMetric.chanceToWin * 100).toFixed(1) +
                " chance to beat the baseline"
            );
          }
        }
      }
    }

    if (experimentChanges.length) {
      // send an email to any subscribers on this test:
      const watchers = await getExperimentWatchers(
        experiment.id,
        experiment.organization
      );
      const userIds = watchers.map((w) => w.userId);

      await sendExperimentChangesEmail(
        userIds,
        experiment.id,
        experiment.name,
        experimentChanges
      );
    }
  } catch (e) {
    logger.error(e, "Failed to send significance email");
  }
}
