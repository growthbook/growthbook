import Agenda, { Job } from "agenda";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  cancelScheduledPublishesForFeature,
  dangerouslyFindRevisionsDueToPublish,
  getRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { maybePublishScheduledRevision as maybePublishScheduledFeatureRevision } from "back-end/src/api/features/autoPublishOnApproval";
import { RevisionModel } from "back-end/src/models/RevisionModel";
import { getAdapter } from "back-end/src/revisions";
import { maybePublishScheduledRevision as maybePublishScheduledEntityRevision } from "back-end/src/revisions/revisionActions";

// One scheduled-publish job covers both kinds of revision: legacy feature
// revisions (FeatureRevisionModel) and generic entity revisions (RevisionModel,
// e.g. saved groups). A single poller finds everything due and a single handler
// branches on `kind`, so there is exactly one Agenda handler — two flows can't
// collide on the same job name.
type ScheduledPublishJobData =
  | {
      kind: "feature";
      organization: string;
      featureId: string;
      version: number;
    }
  | { kind: "revision"; organization: string; revisionId: string };

type ScheduledPublishJob = Job<ScheduledPublishJobData>;

const QUEUE_SCHEDULED_PUBLISHES = "queueScheduledPublishes";
const PUBLISH_SCHEDULED_REVISION = "publishScheduledRevision";

const POLL_INTERVAL_MINUTES = 1;

async function queueScheduledPublish(
  agenda: Agenda,
  data: ScheduledPublishJobData,
) {
  const job = agenda.create(
    PUBLISH_SCHEDULED_REVISION,
    data,
  ) as ScheduledPublishJob;
  // Dedup per item across overlapping poll ticks and multiple back-end
  // instances. The publish re-fetches and re-checks, so a stale re-run after a
  // success no-ops.
  job.unique({ ...data });
  job.schedule(new Date());
  await job.save();
}

const publishScheduledRevision = async (job: ScheduledPublishJob) => {
  const data = job.attrs.data;
  if (!data || !data.organization) return;

  const context = await getContextForAgendaJobByOrgId(data.organization);

  if (data.kind === "feature") {
    const { organization, featureId, version } = data;
    if (!featureId || version === undefined || version === null) return;

    const feature = await getFeature(context, featureId);
    if (!feature) return;

    // archiveFeature already cancels schedules; this guards against a race so we
    // don't resurrect an archived feature's draft.
    if (feature.archived) {
      await cancelScheduledPublishesForFeature(
        context,
        organization,
        featureId,
      );
      return;
    }

    const revision = await getRevision({
      context,
      organization,
      featureId,
      feature,
      version,
    });
    if (!revision) return;

    // Re-checks the due gate and governance; holds and retries next tick if not
    // ready.
    await maybePublishScheduledFeatureRevision(context, feature, revision);
    return;
  }

  // kind === "revision": generic entity revision (saved groups, etc.).
  const { revisionId } = data;
  if (!revisionId) return;

  const revision = await context.models.revisions.getById(revisionId);
  if (!revision) return;

  const entityModel = getAdapter(revision.target.type).getModel(context);
  if (!entityModel) return;

  const entity = await entityModel.getById(revision.target.id);
  if (!entity) {
    // The underlying entity was deleted — cancel the stale schedule so the
    // poller stops finding and re-queuing it every tick.
    await context.models.revisions
      .setScheduledPublish(revisionId, null, { scheduledPublishAt: null })
      .catch((e) =>
        logger.error(
          e,
          `Error canceling schedule for deleted entity (revision ${revisionId})`,
        ),
      );
    return;
  }

  // Re-checks the due gate and governance; holds and retries next tick if not
  // ready (records the failure for the "stuck" indicator).
  await maybePublishScheduledEntityRevision(
    context,
    revision,
    entity as Record<string, unknown>,
  );
};

export default async function addScheduledPublishJob(agenda: Agenda) {
  agenda.define(QUEUE_SCHEDULED_PUBLISHES, async () => {
    const now = new Date();

    const featureDue = await dangerouslyFindRevisionsDueToPublish(now);
    for (const item of featureDue) {
      try {
        await queueScheduledPublish(agenda, { kind: "feature", ...item });
      } catch (e) {
        logger.error(
          e,
          `Error queuing scheduled publish for feature ${item.featureId} v${item.version} (org ${item.organization})`,
        );
      }
    }

    const revisionDue =
      await RevisionModel.dangerouslyFindRevisionsDueToPublish(now);
    for (const item of revisionDue) {
      try {
        await queueScheduledPublish(agenda, {
          kind: "revision",
          organization: item.organization,
          revisionId: item.id,
        });
      } catch (e) {
        logger.error(
          e,
          `Error queuing scheduled revision publish ${item.id} (org ${item.organization})`,
        );
      }
    }
  });

  agenda.define(PUBLISH_SCHEDULED_REVISION, publishScheduledRevision);

  const job = agenda.create(QUEUE_SCHEDULED_PUBLISHES, {});
  job.unique({});
  job.repeatEvery(`${POLL_INTERVAL_MINUTES} minutes`);
  await job.save();
}
