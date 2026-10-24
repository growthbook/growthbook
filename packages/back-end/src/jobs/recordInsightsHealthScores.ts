import Agenda, { Job } from "agenda";
import { getCollection } from "back-end/src/util/mongo.util";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { getOrganizationsWithRunningExperiments } from "back-end/src/models/ExperimentModel";
import { INSIGHTS_HEALTH_SCORES_COLLECTION } from "back-end/src/enterprise/models/InsightsHealthScoreModel";
import {
  recordWeeklyHealthScores,
  startOfUTCWeek,
} from "back-end/src/enterprise/services/insightsHealth";

const QUEUE_HEALTH_SCORES = "queueInsightsHealthScores";
const RECORD_HEALTH_SCORES = "recordInsightsHealthScores";
// Orgs that opened Health this recently keep an unbroken trend
const RECENT_VISIT_DAYS = 90;

type RecordHealthScoresJob = Job<{ organization: string }>;

export default async function addInsightsHealthScoresJob(agenda: Agenda) {
  // Runs daily so a missed run catches up; each org still records once a week
  agenda.define(QUEUE_HEALTH_SCORES, async () => {
    const weekStart = startOfUTCWeek(new Date());
    const since = new Date(
      weekStart.getTime() - RECENT_VISIT_DAYS * 24 * 60 * 60 * 1000,
    );
    // Cross-org, so it reads the collection directly
    const scores = getCollection(INSIGHTS_HEALTH_SCORES_COLLECTION);
    const [running, visited, recorded] = await Promise.all([
      getOrganizationsWithRunningExperiments(),
      scores.distinct("organization", { weekStart: { $gte: since } }),
      scores.distinct("organization", { project: "", weekStart }),
    ]);
    const done = new Set<string>(recorded);
    for (const organization of new Set<string>([...running, ...visited])) {
      if (done.has(organization)) continue;
      const job = agenda.create(RECORD_HEALTH_SCORES, {
        organization,
      }) as RecordHealthScoresJob;
      job.unique({ "data.organization": organization });
      job.schedule(new Date());
      await job.save();
    }
  });

  agenda.define(RECORD_HEALTH_SCORES, async (job: RecordHealthScoresJob) => {
    const organization = job.attrs.data?.organization;
    if (!organization) return;
    await recordWeeklyHealthScores(
      await getContextForAgendaJobByOrgId(organization),
    );
  });

  const job = agenda.create(QUEUE_HEALTH_SCORES, {});
  job.unique({});
  job.repeatEvery("1 day");
  await job.save();
}
