import Agenda, { Job } from "agenda";
import { getOrganizationsWithNorthStars } from "../models/OrganizationModel";
import {
  refreshMetric,
  DEFAULT_METRIC_ANALYSIS_DAYS,
  getMetricAnalysis,
} from "../services/experiments";
import { getMetricById, updateMetric } from "../models/MetricModel";
import { METRIC_REFRESH_FREQUENCY } from "../util/secrets";
import { OrganizationSettings } from "../../types/organization";
import { logger } from "../util/logger";
import { getStatusEndpoint } from "../services/queries";
import { MetricAnalysis, MetricInterface } from "../../types/metric";

const QUEUE_METRIC_UPDATES = "queueMetricUpdates";

const UPDATE_SINGLE_METRIC = "updateSingleMetric";

type UpdateSingleMetricJob = Job<{
  metricId: string;
  orgId: string;
  orgSettings: OrganizationSettings;
}>;

// currently only updating northstar metrics
export default async function (agenda: Agenda) {
  agenda.define(QUEUE_METRIC_UPDATES, async () => {
    const orgsWithNorthStars = await getOrganizationsWithNorthStars();
    for (let i = 0; i < orgsWithNorthStars.length; i++) {
      if (orgsWithNorthStars[i]?.settings?.northStar?.metricIds) {
        const thisOrgsNorthStarMetricIds =
          orgsWithNorthStars[i]?.settings?.northStar?.metricIds || [];
        for (let j = 0; j < thisOrgsNorthStarMetricIds.length; j++) {
          await queueMetricUpdate(
            thisOrgsNorthStarMetricIds[j],
            orgsWithNorthStars[i].id,
            orgsWithNorthStars[i]?.settings || {}
          );
        }
      }
    }
  });

  agenda.define(
    UPDATE_SINGLE_METRIC,
    // This job queries a datasource, which may be slow. Give it 30 minutes to complete.
    { lockLifetime: 30 * 60 * 1000 },
    updateSingleMetric
  );

  // Update experiment results
  await startUpdateJob();

  async function startUpdateJob() {
    const updateResultsJob = agenda.create(QUEUE_METRIC_UPDATES, {});
    updateResultsJob.unique({});
    updateResultsJob.repeatEvery(METRIC_REFRESH_FREQUENCY + " hours");
    await updateResultsJob.save();
  }

  async function queueMetricUpdate(
    metricId: string,
    orgId: string,
    orgSettings: OrganizationSettings
  ) {
    const job = agenda.create(UPDATE_SINGLE_METRIC, {
      metricId,
      orgId,
      orgSettings,
    }) as UpdateSingleMetricJob;

    job.unique({
      metricId,
      orgId,
      orgSettings,
    });
    job.schedule(new Date());
    await job.save();
  }
}

async function updateSingleMetric(job: UpdateSingleMetricJob) {
  const metricId = job.attrs.data?.metricId;
  const orgId = job.attrs.data?.orgId;
  const orgSettings = job.attrs.data?.orgSettings;

  const log = logger.child({
    cron: "updateSingleMetric",
    metricId,
    orgId,
  });

  if (!metricId || !orgId) {
    log.error("Error getting metricId from job");
    return false;
  }
  const metric = await getMetricById(metricId, orgId, true);

  if (!metric) {
    log.error("Error getting metric to refresh: " + metricId);
    return false;
  }

  try {
    log.info("Start Refreshing Metric: " + metricId);
    const days =
      orgSettings?.metricAnalysisDays || DEFAULT_METRIC_ANALYSIS_DAYS;
    await refreshMetric(metric, orgId, days);

    await new Promise<void>((resolve, reject) => {
      const check = async () => {
        const res = await getStatusEndpoint(
          metric,
          orgId,
          (queryData) => getMetricAnalysis(metric, queryData),
          async (updates, result?: MetricAnalysis, error?: string) => {
            const metricUpdates: Partial<MetricInterface> = {
              ...updates,
              analysisError: error,
            };
            if (result) {
              metricUpdates.analysis = result;
            }

            await updateMetric(metric.id, metricUpdates, orgId);
          },
          metric.analysisError
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
  } catch (e) {
    log.error("Error refreshing metric: " + e.message);
  }

  log.info("Success");
}
