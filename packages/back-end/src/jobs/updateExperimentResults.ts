import Agenda, { Job } from "agenda";
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
  getExperimentWatchers,
  getRegressionAdjustmentInfo,
} from "../services/experiments";
import { getConfidenceLevelsForOrg } from "../services/organizations";
import {
  getLatestSnapshot,
  updateSnapshot,
} from "../models/ExperimentSnapshotModel";
import { ExperimentInterface } from "../../types/experiment";
import { getStatusEndpoint } from "../services/queries";
import { getMetricById } from "../models/MetricModel";
import { EXPERIMENT_REFRESH_FREQUENCY } from "../util/secrets";
import { analyzeExperimentResults } from "../services/stats";
import { getReportVariations } from "../services/reports";
import { findOrganizationById } from "../models/OrganizationModel";
import { childLogger } from "../util/logger";
import { ExperimentSnapshotInterface } from "../../types/experiment-snapshot";

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
      await queueExerimentUpdate(
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
      await queueExerimentUpdate(
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

  async function queueExerimentUpdate(
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

  const log = childLogger({
    cron: "updateSingleExperiment",
    experimentId,
  });

  const experiment = await getExperimentById(orgId, experimentId);
  if (!experiment) return;

  const organization = await findOrganizationById(experiment.organization);
  if (!organization) return;
  if (organization?.settings?.updateSchedule?.type === "never") return;

  let lastSnapshot: ExperimentSnapshotInterface | null;
  let currentSnapshot: ExperimentSnapshotInterface;

  try {
    log.info("Start Refreshing Results");
    const datasource = await getDataSourceById(
      experiment.datasource || "",
      experiment.organization
    );
    if (!datasource) return;
    lastSnapshot = await getLatestSnapshot(
      experiment.id,
      experiment.phases.length - 1
    );

    const {
      regressionAdjustmentEnabled,
      metricRegressionAdjustmentStatuses,
    } = await getRegressionAdjustmentInfo(experiment, organization);

    currentSnapshot = await createSnapshot({
      experiment,
      organization,
      phaseIndex: experiment.phases.length - 1,
      statsEngine: organization.settings?.statsEngine,
      regressionAdjustmentEnabled,
      metricRegressionAdjustmentStatuses,
      sequentialTestingEnabled: organization.settings?.sequentialTestingEnabled,
      sequentialTestingTuningParameter: organization.settings?.sequentialTestingTuningParameter,
    });

    await new Promise<void>((resolve, reject) => {
      const check = async () => {
        const phase = experiment.phases[experiment.phases.length - 1];
        if (!phase) {
          reject("Invalid phase");
          return;
        }
        const res = await getStatusEndpoint(
          currentSnapshot,
          currentSnapshot.organization,
          (queryData) => {
            return analyzeExperimentResults(
              experiment.organization,
              getReportVariations(experiment, phase),
              undefined,
              queryData,
              currentSnapshot.statsEngine ?? organization.settings?.statsEngine,
              currentSnapshot.sequentialTestingEnabled ??
                organization.settings?.sequentialTestingEnabled,
              currentSnapshot.sequentialTestingTuningParameter ??
                organization.settings?.sequentialTestingTuningParameter
            );
          },
          async (updates, results, error) => {
            await updateSnapshot(experiment.organization, currentSnapshot.id, {
              ...updates,
              unknownVariations: results?.unknownVariations || [],
              multipleExposures: results?.multipleExposures || 0,
              results: results?.dimensions || currentSnapshot.results,
              error,
            });
          },
          currentSnapshot.error
        );
        if (res.queryStatus === "succeeded") {
          resolve();
          return;
        }
        if (res.queryStatus === "failed") {
          reject("Queries failed to run");
          return;
        }
        // Check every 10 seconds
        setTimeout(check, 10000);
      };
      // Do the first check after a 2 second delay to quickly handle fast queries
      setTimeout(check, 2000);
    });

    log.info("Success");

    if (lastSnapshot) {
      await sendSignificanceEmail(experiment, lastSnapshot, currentSnapshot);
    }
  } catch (e) {
    log.error("Failure - " + e.message);
    // If we failed to update the experiment, turn off auto-updating for the future
    try {
      await updateExperiment({
        organization,
        experiment,
        user: null,
        changes: {
          autoSnapshots: false,
        },
      });
      // TODO: email user and let them know it failed
    } catch (e) {
      log.error("Failed to turn off autoSnapshots - " + e.message);
    }
  }
}

async function sendSignificanceEmail(
  experiment: ExperimentInterface,
  lastSnapshot: ExperimentSnapshotInterface,
  currentSnapshot: ExperimentSnapshotInterface
) {
  const log = childLogger({
    cron: "sendSignificanceEmail",
    experimentId: experiment.id,
  });

  // If email is not configured, there's nothing else to do
  if (!isEmailEnabled()) {
    return;
  }

  if (!currentSnapshot?.results?.[0]?.variations) {
    return;
  }

  try {
    // get the org confidence level settings:
    const { ciUpper, ciLower } = await getConfidenceLevelsForOrg(
      experiment.organization
    );

    // check this and the previous snapshot to see if anything changed:
    const experimentChanges: string[] = [];
    for (let i = 1; i < currentSnapshot.results[0].variations.length; i++) {
      const curVar = currentSnapshot.results?.[0]?.variations?.[i];
      const lastVar = lastSnapshot.results?.[0]?.variations?.[i];

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
                getMetricById(m, experiment.organization) +
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
                getMetricById(m, experiment.organization) +
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
      log.info(
        "Significant change - detected " +
          experimentChanges.length +
          " significant changes"
      );
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
    log.error(e.message);
  }
}
