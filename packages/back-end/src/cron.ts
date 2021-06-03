import { init } from "./app";
import { ExperimentModel } from "./models/ExperimentModel";
import {
  createSnapshot,
  getExperimentWatchers,
  getLatestSnapshot,
  getMetricById,
} from "./services/experiments";
import { getDataSourceById } from "./services/datasource";
import pino from "pino";
import { isEmailEnabled, sendExperimentChangesEmail } from "./services/email";
import { getConfidenceLevelsForOrg } from "./services/organizations";

const MAX_UPDATES = 10;
const UPDATE_FREQUENCY = 360;

const parentLogger = pino();
const logger = parentLogger.child({
  cron: true,
});

logger.info("Cron started");

// Time out after 30 minutes
const timer = setTimeout(() => {
  logger.warn("Cron Timeout");
  process.exit(1);
}, 30 * 60 * 1000);

(async () => {
  await init();

  const latestDate = new Date();
  latestDate.setMinutes(latestDate.getMinutes() - UPDATE_FREQUENCY);

  const experiments = await ExperimentModel.find({
    datasource: {
      $exists: true,
      $ne: "",
    },
    status: "running",
    autoSnapshots: true,
    lastSnapshotAttempt: {
      $lte: latestDate,
    },
  })
    .limit(MAX_UPDATES)
    .sort({
      lastSnapshotAttempt: 1,
    });

  const promises = experiments.map(async (experiment) => {
    try {
      logger.info({ experiment: experiment.id }, "Updating experiment - Start");
      const datasource = await getDataSourceById(experiment.datasource);
      const lastSnapshot = await getLatestSnapshot(
        experiment.id,
        experiment.phases.length - 1
      );
      const currentSnapshot = await createSnapshot(
        experiment,
        experiment.phases.length - 1,
        datasource
      );
      logger.info(
        { experiment: experiment.id },
        "Updating experiment - Success"
      );

      // get the org confidence level settings:
      const { ciUpper, ciLower } = await getConfidenceLevelsForOrg(
        experiment.organization
      );

      // check this and the previous snapshot to see if anything changed:

      // asumptions:
      // - that result[0] in the current snapshot is what we care about
      // - that result[0] in the last snapshot is the same (could add a check for this)
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
              /* else if(curVar.metrics[m].chanceToWin < 0.85 && lastVar.metrics[m].chanceToWin > 0.95) {
              // this test variation was significant, but is now not.
              experimentChanges.push(
                "The metric "+getMetricById(m)+" is no longer a significant improvement for variation "+experiment.variations[i].name+" ("+lastVar.metrics[m].chanceToWin.toFixed(3)+" to "+ curVar.metrics[m].chanceToWin.toFixed(3)+")"
              );
            } */
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
            /*
            else if(curVar.metrics[m].chanceToWin > 0.15 && lastVar.metrics[m].chanceToWin < 0.05) {
              // this test was significant, and lost, but now hasn't.
              experimentChanges.push(
                "The metric "+getMetricById(m)+" is no longer significant for variation "+experiment.variations[i].name+" ("+lastVar.metrics[m].chanceToWin.toFixed(3)+" to "+ curVar.metrics[m].chanceToWin.toFixed(3)+")"
              );
            }
            */
          }
        }
      }

      if (experimentChanges.length) {
        // send an email to any subscribers on this test:
        logger.info(
          { experiment: experiment.id },
          "Significant change - detected " +
            experimentChanges.length +
            " significant changes"
        );
        if (!isEmailEnabled()) {
          logger.error(
            { experiment: experiment.id },
            "Significant change - not sending as email not enabled"
          );
        } else {
          const watchers = await getExperimentWatchers(experiment.id);
          const userIds = watchers.map((w) => w.userId);

          try {
            await sendExperimentChangesEmail(
              userIds,
              experiment.id,
              experiment.name,
              experimentChanges
            );
          } catch (e) {
            logger.error(
              { experiment: experiment.id },
              "Significant change - Email sending failure:"
            );
            logger.error({ experiment: experiment.id }, e.message);
          }
        }
      }
    } catch (e) {
      logger.error(
        { experiment: experiment.id },
        "Updating experiment - Failure"
      );

      try {
        experiment.autoSnapshots = false;
        experiment.markModified("autoSnapshots");
        await experiment.save();
        // TODO: email user and let them know it failed
      } catch (e) {
        logger.error({ experiment: experiment.id }, e.message);
      }
    }
  });
  await Promise.all(promises);
  logger.info("Cron finished");
  clearTimeout(timer);
  process.exit(0);
})();
