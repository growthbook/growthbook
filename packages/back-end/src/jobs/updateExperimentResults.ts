import Agenda, { Job } from "agenda";
import { ExperimentModel } from "../models/ExperimentModel";
import { getDataSourceById } from "../services/datasource";
import { isEmailEnabled, sendExperimentChangesEmail } from "../services/email";
import {
  createSnapshot,
  getExperimentWatchers,
  getLatestSnapshot,
  getMetricById,
} from "../services/experiments";
import { getConfidenceLevelsForOrg } from "../services/organizations";
import pino from "pino";
import { ExperimentSnapshotDocument } from "../models/ExperimentSnapshotModel";
import { ExperimentInterface } from "../../types/experiment";

// Time between experiment result updates (6 hours)
const UPDATE_EVERY = 6 * 60 * 60 * 1000;

const QUEUE_EXPERIMENT_UPDATES = "queueExperimentUpdates";

const UPDATE_SINGLE_EXP = "updateSingleExperiment";
type UpdateSingleExpJob = Job<{
  experimentId: string;
}>;

const parentLogger = pino();

export default async function (agenda: Agenda) {
  agenda.define(QUEUE_EXPERIMENT_UPDATES, async () => {
    // All experiments that haven't been updated in at least UPDATE_EVERY ms
    const latestDate = new Date(Date.now() - UPDATE_EVERY);

    const experimentIds = (
      await ExperimentModel.find(
        {
          datasource: {
            $exists: true,
            $ne: "",
          },
          status: "running",
          autoSnapshots: true,
          lastSnapshotAttempt: {
            $lte: latestDate,
          },
        },
        {
          id: true,
        }
      )
        .limit(100)
        .sort({
          lastSnapshotAttempt: 1,
        })
    ).map((e) => e.id);

    for (let i = 0; i < experimentIds.length; i++) {
      await queueExerimentUpdate(experimentIds[i]);
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

  async function startUpdateJob() {
    const updateResultsJob = agenda.create(QUEUE_EXPERIMENT_UPDATES, {});
    updateResultsJob.unique({});
    updateResultsJob.repeatEvery("10 minutes");
    await updateResultsJob.save();
  }

  async function queueExerimentUpdate(experimentId: string) {
    const job = agenda.create(UPDATE_SINGLE_EXP, {
      experimentId,
    }) as UpdateSingleExpJob;

    job.unique({
      experimentId,
    });
    job.schedule(new Date());
    await job.save();
  }
}

async function updateSingleExperiment(job: UpdateSingleExpJob) {
  const { experimentId } = job.attrs.data;

  const logger = parentLogger.child({
    cron: "updateSingleExperiment",
    experimentId,
  });

  const experiment = await ExperimentModel.findOne({
    id: experimentId,
  });

  let lastSnapshot: ExperimentSnapshotDocument;
  let currentSnapshot: ExperimentSnapshotDocument;

  try {
    logger.info("Start Refreshing Results");
    const datasource = await getDataSourceById(experiment.datasource);
    lastSnapshot = await getLatestSnapshot(
      experiment.id,
      experiment.phases.length - 1
    );
    currentSnapshot = await createSnapshot(
      experiment,
      experiment.phases.length - 1,
      datasource,
      null,
      false
    );
    logger.info("Success");

    await sendSignificanceEmail(experiment, lastSnapshot, currentSnapshot);
  } catch (e) {
    logger.error("Failure - " + e.message);
    // If we failed to update the experiment, turn off auto-updating for the future
    try {
      experiment.autoSnapshots = false;
      experiment.markModified("autoSnapshots");
      await experiment.save();
      // TODO: email user and let them know it failed
    } catch (e) {
      logger.error("Failed to turn off autoSnapshots - " + e.message);
    }
  }
}

async function sendSignificanceEmail(
  experiment: ExperimentInterface,
  lastSnapshot: ExperimentSnapshotDocument,
  currentSnapshot: ExperimentSnapshotDocument
) {
  const logger = parentLogger.child({
    cron: "sendSignificanceEmail",
    experimentId: experiment.id,
  });

  // If email is not configured, there's nothing else to do
  if (!isEmailEnabled()) {
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
      const curVar = currentSnapshot.results[0].variations[i];
      const lastVar = lastSnapshot.results[0].variations[i];

      for (const m in curVar.metrics) {
        // sanity checks:
        if (
          lastVar.metrics[m] &&
          lastVar.metrics[m].chanceToWin &&
          curVar.metrics[m].value > 150
        ) {
          // checks to see if anything changed:
          if (
            curVar.metrics[m].chanceToWin > ciUpper &&
            lastVar.metrics[m].chanceToWin < ciUpper
          ) {
            // this test variation has gone significant, and won
            experimentChanges.push(
              "The metric " +
                getMetricById(m) +
                " for variation " +
                experiment.variations[i].name +
                " has reached a " +
                (curVar.metrics[m].chanceToWin * 100).toFixed(1) +
                "% chance to beat baseline"
            );
          } else if (
            curVar.metrics[m].chanceToWin < ciLower &&
            lastVar.metrics[m].chanceToWin > ciLower
          ) {
            // this test variation has gone significant, and lost
            experimentChanges.push(
              "The metric " +
                getMetricById(m) +
                " for variation " +
                experiment.variations[i].name +
                " has dropped to a " +
                (curVar.metrics[m].chanceToWin * 100).toFixed(1) +
                " chance to beat the baseline"
            );
          }
        }
      }
    }

    if (experimentChanges.length) {
      // send an email to any subscribers on this test:
      logger.info(
        "Significant change - detected " +
          experimentChanges.length +
          " significant changes"
      );
      const watchers = await getExperimentWatchers(experiment.id);
      const userIds = watchers.map((w) => w.userId);

      await sendExperimentChangesEmail(
        userIds,
        experiment.id,
        experiment.name,
        experimentChanges
      );
    }
  } catch (e) {
    logger.error(e.message);
  }
}
