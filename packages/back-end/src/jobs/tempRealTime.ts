import Agenda, { Job } from "agenda";
import { OrganizationSettings } from "../../types/organization";
import {
  getRealtimeFeatureByHour,
  updateRealtimeUsage,
} from "../models/RealtimeModel";
import pino from "pino";

const parentLogger = pino();

const REALTIME_JOB_NAME = "updateRealtimeFeatures";
type RealtimeJob = Job<{
  metricId: string;
  orgId: string;
  orgSettings: OrganizationSettings;
}>;
let agenda: Agenda;

export default async function (ag: Agenda) {
  agenda = ag;

  const logger = parentLogger.child({
    cron: "Update realtime",
  });
  // Fire webhooks
  agenda.define(REALTIME_JOB_NAME, async () => {
    // update to org you want to populate:
    const orgId = "org_1wulbmmnkfwvivc1";
    logger.info("main job called");
    const key = "_overall";
    const hour = new Date();
    hour.setHours(hour.getHours(), 0, 0, 0);
    const currentHour = hour.getTime() / 1000;
    const min = new Date().getMinutes();
    console.log("running ", currentHour);
    // const updates: Partial<RealtimeUsageInterface> = {
    //   hour: hour,
    //   counts: {
    //     key: {}
    //   }
    // };
    const rt = await getRealtimeFeatureByHour(orgId, currentHour);
    let total = rt?.counts[key]?.total || 0;
    const newAmount = Math.round(Math.random() * 100);
    total += newAmount;

    await updateRealtimeUsage(orgId, currentHour, {
      [`counts.${key}.total`]: total,
      [`counts.${key}.minutes.${min}`]: newAmount,
    });
  });
  agenda.on(
    "fail:" + REALTIME_JOB_NAME,
    async (error: Error, job: RealtimeJob) => {
      if (!job.attrs.data) return;
      let nextRunAt = Date.now();
      // Wait60s after the first failure
      nextRunAt += 60000;
      job.attrs.nextRunAt = new Date(nextRunAt);
      await job.save();
    }
  );

  // Update experiment results
  await startUpdateJob();

  async function startUpdateJob() {
    const updateResultsJob = agenda.create(REALTIME_JOB_NAME, {});
    updateResultsJob.unique({});
    updateResultsJob.repeatEvery(1 + " minute");
    await updateResultsJob.save();
  }
}
