import Agenda from "agenda";
import { findRunningSnapshotsByQueryId } from "back-end/src/models/ExperimentSnapshotModel";
import { findRunningMetricsByQueryId } from "back-end/src/models/MetricModel";
import { findRunningPastExperimentsByQueryId } from "back-end/src/models/PastExperimentsModel";
import { getStaleQueuedQueries } from "back-end/src/models/QueryModel";
import { findReportsByQueryId } from "back-end/src/models/ReportModel";
import { trackJob } from "back-end/src/services/otel";
import { logger } from "back-end/src/util/logger";
import {
  udpateReportsStatus,
  updateMetricsStatus,
  updatePastExperimentsStatus,
  updateSnapshotsStatus,
} from "./expireOldQueries";
const JOB_NAME = "expireQueuedQueries";

const expireQueuedQueries = trackJob(JOB_NAME, async () => {
  const queries = await getStaleQueuedQueries();
  const queryIds = new Set(queries.map((q) => q.id));
  const orgIds = new Set(queries.map((q) => q.organization));

  if (queryIds.size > 0) {
    logger.info("Found " + queryIds.size + " stale queries");
  } else {
    logger.debug("Found no stale queries");
  }

  // Look for matching snapshots and update the status
  const snapshots = await findRunningSnapshotsByQueryId([...queryIds]);
  await updateSnapshotsStatus(snapshots, queryIds);

  // Look for matching reports and update the status
  const reports = await findReportsByQueryId([...queryIds]);
  await udpateReportsStatus(reports, queryIds);

  // Look for matching metrics and update the status
  const metrics = await findRunningMetricsByQueryId([...orgIds], [...queryIds]);
  await updateMetricsStatus(metrics, queryIds);

  // Look for matching pastExperiments and update the status
  const pastExperiments = await findRunningPastExperimentsByQueryId(
    [...orgIds],
    [...queryIds]
  );
  await updatePastExperimentsStatus(pastExperiments, queryIds);
});

export default async function (agenda: Agenda) {
  agenda.define(JOB_NAME, expireQueuedQueries);

  const job = agenda.create(JOB_NAME, {});
  job.unique({});
  job.repeatEvery("24 hours");
  await job.save();
}
