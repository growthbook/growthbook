import Agenda from "agenda";
import { Queries } from "shared/types/query";
import {
  findRunningSnapshotsByQueryId,
  updateSnapshot,
} from "back-end/src/models/ExperimentSnapshotModel";
import {
  findRunningMetricsByQueryId,
  updateMetricQueriesAndStatus,
} from "back-end/src/models/MetricModel";
import {
  findRunningPastExperimentsByQueryId,
  updatePastExperiments,
} from "back-end/src/models/PastExperimentsModel";
import { getStaleQueries } from "back-end/src/models/QueryModel";
import {
  findReportsByQueryId,
  updateReport,
} from "back-end/src/models/ReportModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import { MetricAnalysisModel } from "../models/MetricAnalysisModel";
const JOB_NAME = "expireOldQueries";

function updateQueryStatus(queries: Queries, ids: Set<string>) {
  queries.forEach((q) => {
    if (ids.has(q.query)) {
      q.status = "failed";
    }
  });
}

const expireOldQueries = async () => {
  const queries = await getStaleQueries();
  const queryIds = new Set(queries.map((q) => q.id));
  const orgIds = new Set(queries.map((q) => q.organization));

  if (queryIds.size > 0) {
    logger.info("Found " + queryIds.size + " stale queries");
  } else {
    logger.debug("Found no stale queries");
  }

  // Look for matching snapshots and update the status
  const snapshots = await findRunningSnapshotsByQueryId([...queryIds]);
  for (let i = 0; i < snapshots.length; i++) {
    const snapshot = snapshots[i];
    logger.info("Updating status of snapshot " + snapshot.id);
    updateQueryStatus(snapshot.queries, queryIds);
    await updateSnapshot({
      organization: snapshot.organization,
      id: snapshot.id,
      updates: {
        error: "Queries were interupted. Please try updating results again.",
        status: "error",
        queries: snapshot.queries,
      },
      context: await getContextForAgendaJobByOrgId(snapshot.organization),
    });
  }

  // Look for matching reports and update the status
  const reports = await findReportsByQueryId([...queryIds]);
  for (let i = 0; i < reports.length; i++) {
    const report = reports[i];
    if (report.type !== "experiment") continue;
    logger.info("Updating status of report " + report.id);
    updateQueryStatus(report.queries, queryIds);
    await updateReport(report.organization, report.id, {
      error: "Queries were interupted. Please try updating results again.",
      queries: report.queries,
    });
  }

  // Look for matching metrics and update the status
  const metrics = await findRunningMetricsByQueryId([...orgIds], [...queryIds]);
  for (let i = 0; i < metrics.length; i++) {
    const metric = metrics[i];
    logger.info("Updating status of metric " + metric.id);
    updateQueryStatus(metric.queries, queryIds);
    await updateMetricQueriesAndStatus(metric, {
      queries: metric.queries,
      analysisError:
        "Queries were interupted. Please try re-running the analysis.",
    });
  }

  // Look for matching pastExperiments and update the status
  const pastExperiments = await findRunningPastExperimentsByQueryId(
    [...orgIds],
    [...queryIds],
  );
  for (let i = 0; i < pastExperiments.length; i++) {
    const pastExperiment = pastExperiments[i];
    logger.info("Updating status of pastExperiment " + pastExperiment.id);
    updateQueryStatus(pastExperiment.queries, queryIds);
    await updatePastExperiments(pastExperiment, {
      queries: pastExperiment.queries,
      error: "Queries were interupted. Please try refreshing the list.",
    });
  }

  const metricAnalyses = await MetricAnalysisModel.findByQueryIds(
    [...orgIds],
    [...queryIds],
  );
  for (const metricAnalysis of metricAnalyses) {
    logger.info("Updating status of metricAnalysis " + metricAnalysis.id);
    const context = await getContextForAgendaJobByOrgId(
      metricAnalysis.organization,
    );
    updateQueryStatus(metricAnalysis.queries, queryIds);
    await context.models.metricAnalysis.update(metricAnalysis, {
      queries: metricAnalysis.queries,
      error: "Queries were interupted. Please try refreshing the results.",
    });
  }
};

export default async function (agenda: Agenda) {
  agenda.define(JOB_NAME, expireOldQueries);

  const job = agenda.create(JOB_NAME, {});
  job.unique({});
  job.repeatEvery("1 minute");
  await job.save();
}
