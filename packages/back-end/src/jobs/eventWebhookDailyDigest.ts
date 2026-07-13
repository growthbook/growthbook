import Agenda from "agenda";
import { createEvent, EventModel } from "back-end/src/models/EventModel";
import { FeatureModel } from "back-end/src/models/FeatureModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";

// Hourly maintenance job. The Slack digests are delivered by
// eventWebhookWeeklyDigest; this job only emits "stale feature candidate"
// events, which flow through the normal notification + digest pipeline.
const DAILY_DIGEST_JOB = "eventWebhookDailyDigest";
const STALE_FEATURE_DAYS = 180;
const STALE_FEATURE_REPEAT_DAYS = 7;
const ENABLE_STALE_FEATURE_CANDIDATE_EVENTS = false;

const emitStaleFeatureCandidateEvents = async () => {
  const staleBefore = new Date(
    Date.now() - STALE_FEATURE_DAYS * 24 * 60 * 60 * 1000,
  );
  const repeatAfter = new Date(
    Date.now() - STALE_FEATURE_REPEAT_DAYS * 24 * 60 * 60 * 1000,
  );
  const features = await FeatureModel.find({
    archived: { $ne: true },
    neverStale: { $ne: true },
    dateUpdated: { $lte: staleBefore },
  })
    .limit(200)
    .lean<
      {
        id: string;
        organization: string;
        project?: string;
        tags?: string[];
        dateUpdated?: Date;
      }[]
    >();

  for (const feature of features) {
    const existing = await EventModel.findOne({
      organizationId: feature.organization,
      object: "feature",
      objectId: feature.id,
      event: "feature.stale.candidate",
      dateCreated: { $gte: repeatAfter },
    });
    if (existing) continue;

    const context = await getContextForAgendaJobByOrgId(feature.organization);
    await createEvent({
      context,
      object: "feature",
      objectId: feature.id,
      event: "stale.candidate",
      data: {
        object: {
          featureId: feature.id,
          daysSinceLastUpdate: feature.dateUpdated
            ? Math.floor(
                (Date.now() - feature.dateUpdated.getTime()) /
                  (24 * 60 * 60 * 1000),
              )
            : undefined,
          reason:
            "This flag has not been updated recently and may be ready to remove from code.",
        },
      },
      projects: feature.project ? [feature.project] : [],
      tags: feature.tags || [],
      environments: [],
      containsSecrets: false,
    });
  }
};

export default async function (agenda: Agenda) {
  agenda.define(DAILY_DIGEST_JOB, async () => {
    if (ENABLE_STALE_FEATURE_CANDIDATE_EVENTS) {
      await emitStaleFeatureCandidateEvents();
    }
  });

  const job = agenda.create(DAILY_DIGEST_JOB, {});
  job.unique({});
  job.repeatEvery("1 hour");
  await job.save();
}
