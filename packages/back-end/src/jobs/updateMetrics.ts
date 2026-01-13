import Agenda, { Job } from "agenda";
import { OrganizationInterface } from "shared/types/organization";
import { getOrganizationsWithNorthStars } from "back-end/src/models/OrganizationModel";
import {
  DEFAULT_METRIC_ANALYSIS_DAYS,
  refreshMetric,
} from "back-end/src/services/experiments";
import { getMetricById } from "back-end/src/models/MetricModel";
import { METRIC_REFRESH_FREQUENCY } from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";
import { promiseAllChunks } from "back-end/src/util/promise";
import {
  getContextForAgendaJobByOrgObject,
  getOrganizationById,
} from "back-end/src/services/organizations";

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
      organization: OrganizationInterface;
      id: string;
      daysToInclude: number;
    }[] = [];
    orgsWithNorthStars.forEach((org) => {
      org?.settings?.northStar?.metricIds?.forEach((metricId) =>
        metrics.push({
          organization: org,
          id: metricId,
          daysToInclude:
            org?.settings?.metricAnalysisDays || DEFAULT_METRIC_ANALYSIS_DAYS,
        }),
      );
    });

    const lastRefreshDate = new Date();
    lastRefreshDate.setHours(
      lastRefreshDate.getHours() - METRIC_REFRESH_FREQUENCY,
    );

    const promiseCallbacks: (() => Promise<unknown>)[] = [];
    metrics.forEach(({ organization, id, daysToInclude }) => {
      promiseCallbacks.push(async () => {
        const context = getContextForAgendaJobByOrgObject(organization);

        const metric = await getMetricById(context, id, true);
        if (!metric) return;

        // Skip manual metrics
        if (!metric.datasource) return;

        // Skip if metric was already refreshed recently
        if (
          metric.runStarted &&
          metric.runStarted.getTime() > lastRefreshDate.getTime()
        ) {
          return;
        }

        await queueMetricUpdate(id, organization.id, daysToInclude);
      });
    });

    await promiseAllChunks(promiseCallbacks, 5);
  });

  agenda.define(UPDATE_SINGLE_METRIC, updateSingleMetric);

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
    daysToInclude: number,
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

const updateSingleMetric = async (job: UpdateSingleMetricJob) => {
  const metricId = job.attrs.data?.metricId;
  const orgId = job.attrs.data?.orgId;
  const daysToInclude =
    job.attrs.data?.daysToInclude || DEFAULT_METRIC_ANALYSIS_DAYS;

  try {
    if (!metricId || !orgId) {
      throw new Error("Error getting metricId or orgId from job");
    }

    const org = await getOrganizationById(orgId);
    if (!org) {
      throw new Error("Error getting org to refresh metric: " + orgId);
    }
    const context = getContextForAgendaJobByOrgObject(org);

    const metric = await getMetricById(context, metricId, true);

    if (!metric) {
      throw new Error("Error getting metric to refresh: " + metricId);
    }

    logger.info("Start Refreshing Metric: " + metricId);
    await refreshMetric(context, metric, daysToInclude);
    logger.info("Successfully Refreshed Metric: " + metricId);
  } catch (e) {
    logger.error(e, "Error refreshing metric: " + metricId);
    return false;
  }
};
