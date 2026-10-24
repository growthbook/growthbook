import Agenda, { Job } from "agenda";
import { HEALTH_SCORE_ALL_PROJECTS } from "shared/validators";
import { startOfUTCWeek } from "shared/enterprise";
import { getCollection } from "back-end/src/util/mongo.util";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { getOrganizationsWithRunningExperiments } from "back-end/src/models/ExperimentModel";
import { INSIGHTS_HEALTH_SCORES_COLLECTION } from "back-end/src/enterprise/models/InsightsHealthScoreModel";
import { recordWeeklyHealthScores } from "back-end/src/enterprise/services/insightsHealth";

const QUEUE_HEALTH_SCORES = "queueInsightsHealthScores";
const RECORD_HEALTH_SCORES = "recordInsightsHealthScores";

type RecordHealthScoresJob = Job<{ organization: string }>;

// Orgs with a running experiment get a score every week; visiting Health
// records the week for any other org
export default async function addInsightsHealthScoresJob(agenda: Agenda) {
  // Runs daily so a missed run catches up; each org still records once a week
  agenda.define(QUEUE_HEALTH_SCORES, async () => {
    const weekStart = startOfUTCWeek(new Date());
    const [running, recorded] = await Promise.all([
      getOrganizationsWithRunningExperiments(),
      // Cross-org, so it reads the collection directly
      getCollection(INSIGHTS_HEALTH_SCORES_COLLECTION).distinct(
        "organization",
        { scope: HEALTH_SCORE_ALL_PROJECTS, weekStart },
      ),
    ]);
    const done = new Set<string>(recorded);
    for (const organization of running) {
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
