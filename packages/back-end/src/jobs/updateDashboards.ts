import Agenda, { Job } from "agenda";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import { DashboardModel } from "../enterprise/models/DashboardModel";
import { updateNonExperimentDashboard } from "../enterprise/services/dashboards";

const QUEUE_DASHBOARD_UPDATES = "queueDashboardUpdates";

const UPDATE_SINGLE_DASH = "updateSingleDashboard";
type UpdateSingleDashJob = Job<{
  organization: string;
  dashboardId: string;
}>;

export default async function (agenda: Agenda) {
  agenda.define(QUEUE_DASHBOARD_UPDATES, async () => {
    const dashboards = await DashboardModel.getDashboardsToUpdate();

    for (let i = 0; i < dashboards.length; i++) {
      await queueDashboardUpdate(dashboards[i].organization, dashboards[i].id);
    }
  });

  agenda.define(UPDATE_SINGLE_DASH, updateSingleDashboard);

  await startUpdateJob();

  async function startUpdateJob() {
    const updateResultsJob = agenda.create(QUEUE_DASHBOARD_UPDATES, {});
    updateResultsJob.unique({});
    updateResultsJob.repeatEvery("10 minutes");
    await updateResultsJob.save();
  }

  async function queueDashboardUpdate(
    organization: string,
    dashboardId: string,
  ) {
    const job = agenda.create(UPDATE_SINGLE_DASH, {
      organization,
      dashboardId,
    }) as UpdateSingleDashJob;

    job.unique({
      dashboardId,
      organization,
    });
    job.schedule(new Date());
    await job.save();
  }
}

const updateSingleDashboard = async (job: UpdateSingleDashJob) => {
  const dashboardId = job.attrs.data?.dashboardId;
  const orgId = job.attrs.data?.organization;

  if (!dashboardId || !orgId) return;

  const context = await getContextForAgendaJobByOrgId(orgId);

  const { org: organization } = context;

  const dashboard = await context.models.dashboards.getById(dashboardId);
  if (!dashboard) return;

  // Disable auto snapshots for the dashboard so it doesn't keep trying to update if schedule is off
  if (organization?.settings?.updateSchedule?.type === "never") {
    await context.models.dashboards.dangerousUpdateByIdBypassPermission(
      dashboardId,
      {
        enableAutoUpdates: false,
      },
    );
    return;
  }

  try {
    logger.info("Start Refreshing Results for dashboard " + dashboardId);
    await updateNonExperimentDashboard(context, dashboard);
    logger.info("Successfully Refreshed Results for dashboard " + dashboardId);
  } catch (e) {
    logger.error(e, "Failed to update dashboard: " + dashboardId);
    // If we failed to update the dashboard, turn off auto-updating for the future
    try {
      await context.models.dashboards.dangerousUpdateByIdBypassPermission(
        dashboardId,
        {
          enableAutoUpdates: false,
        },
      );
    } catch (e) {
      logger.error(e, "Failed to turn off dashboard updates: " + dashboardId);
    }
  }
};
