import Agenda, { Job } from "agenda";
import { getOrganizationsWithNorthStars } from "../models/OrganizationModel";
import {
  refreshMetric,
  DEFAULT_METRIC_ANALYSIS_DAYS,
} from "../services/experiments";
import pino from "pino";
import { getMetricById } from "../models/MetricModel";
import { METRIC_REFRESH_FREQUENCY } from "../util/secrets";
import { OrganizationSettings } from "../../types/organization";

const QUEUE_METRIC_UPDATES = "queueMetricUpdates";

const UPDATE_SINGLE_METRIC = "updateSingleMetric";

type UpdateSingleMetricJob = Job<{
  metricId: string;
  orgId: string;
  orgSettings: OrganizationSettings;
}>;

const parentLogger = pino();

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

  const logger = parentLogger.child({
    cron: "updateSingleMetric",
    metricId,
    orgId,
  });

  if (!metricId || !orgId) {
    logger.error("Error getting metricId from job");
    return false;
  }
  const metric = await getMetricById(metricId, orgId, true);

  if (!metric) {
    logger.error("Error getting metric to refresh: " + metricId);
    return false;
  }

  try {
    logger.info("Start Refreshing Metric: " + metricId);
    const days =
      orgSettings?.metricAnalysisDays || DEFAULT_METRIC_ANALYSIS_DAYS;
    await refreshMetric(metric, orgId, days);
  } catch (e) {
    logger.error("Error refreshing metric: " + e.message);
  }

  logger.info("Success");
}
