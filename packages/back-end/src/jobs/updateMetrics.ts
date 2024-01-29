import Agenda, { Job } from "agenda";
import { getOrganizationsWithNorthStars } from "../models/OrganizationModel";
import {
  DEFAULT_METRIC_ANALYSIS_DAYS,
  refreshMetric,
} from "../services/experiments";
import { getMetricById } from "../models/MetricModel";
import { METRIC_REFRESH_FREQUENCY } from "../util/secrets";
import { logger } from "../util/logger";
import { promiseAllChunks } from "../util/promise";
import {
  getContextForAgendaJobByOrgId,
  getOrganizationById,
} from "../services/organizations";

const QUEUE_METRIC_UPDATES = "queueMetricUpdates";

const UPDATE_SINGLE_METRIC = "updateSingleMetric";

type UpdateSingleMetricJob = Job<{
  metricId: string;
  orgId: string;
  daysToInclude: number;
}>;

// currently only updating northstar metrics
export default async function (agenda: Agenda) {
  agenda.define(QUEUE_METRIC_UPDATES, async () => {
    const orgsWithNorthStars = await getOrganizationsWithNorthStars();

    const metrics: {
      organization: string;
      id: string;
      daysToInclude: number;
    }[] = [];
    orgsWithNorthStars.forEach((org) => {
      org?.settings?.northStar?.metricIds?.forEach((metricId) =>
        metrics.push({
          organization: org.id,
          id: metricId,
          daysToInclude:
            org?.settings?.metricAnalysisDays || DEFAULT_METRIC_ANALYSIS_DAYS,
        })
      );
    });

    const lastRefreshDate = new Date();
    lastRefreshDate.setHours(
      lastRefreshDate.getHours() - METRIC_REFRESH_FREQUENCY
    );

    const promiseCallbacks: (() => Promise<unknown>)[] = [];
    metrics.forEach(({ organization, id, daysToInclude }) => {
      promiseCallbacks.push(async () => {
        const metric = await getMetricById(id, organization, true);
        if (!metric) return;
        // Skip if metric was already refreshed recently
        if (
          metric.runStarted &&
          metric.runStarted.getTime() > lastRefreshDate.getTime()
        ) {
          return;
        }

        await queueMetricUpdate(id, organization, daysToInclude);
      });
    });

    await promiseAllChunks(promiseCallbacks, 5);
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
    daysToInclude: number
  ) {
    const job = agenda.create(UPDATE_SINGLE_METRIC, {
      metricId,
      orgId,
      daysToInclude,
    }) as UpdateSingleMetricJob;

    job.unique({
      metricId,
      orgId,
    });
    job.schedule(new Date());
    await job.save();
  }
}

async function updateSingleMetric(job: UpdateSingleMetricJob) {
  const metricId = job.attrs.data?.metricId;
  const orgId = job.attrs.data?.orgId;
  const daysToInclude =
    job.attrs.data?.daysToInclude || DEFAULT_METRIC_ANALYSIS_DAYS;

  try {
    if (!metricId || !orgId) {
      throw new Error("Error getting metricId or orgId from job");
    }
    const metric = await getMetricById(metricId, orgId, true);

    if (!metric) {
      throw new Error("Error getting metric to refresh: " + metricId);
    }

    const context = await getContextForAgendaJobByOrgId(orgId);

    logger.info("Start Refreshing Metric: " + metricId);
    await refreshMetric(metric, context, daysToInclude);
    logger.info("Successfully Refreshed Metric: " + metricId);
  } catch (e) {
    logger.error(e, "Error refreshing metric: " + metricId);
    return false;
  }
}
