import Agenda from "agenda";
import intersection from "lodash/intersection";
import { EventWebHookInterface } from "shared/types/event-webhook";
import { EventInterface } from "shared/types/events/event";
import {
  getWildcardPatternsForEvent,
  resolveSlackDigest,
  isSlackDigestDue,
} from "shared/validators";
import { createEvent, EventModel } from "back-end/src/models/EventModel";
import { EventWebHookModel } from "back-end/src/models/EventWebhookModel";
import { FeatureModel } from "back-end/src/models/FeatureModel";
import { buildCoalescedSlackMessage } from "back-end/src/events/handlers/slack/slack-event-handler-utils";
import {
  filterEventForEnvironments,
  getFilterDataForNotificationEvent,
} from "back-end/src/events/handlers/utils";
import { cancellableFetch } from "back-end/src/util/http.util";
import { logger } from "back-end/src/util/logger";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";

const DAILY_DIGEST_JOB = "eventWebhookDailyDigest";
const STALE_FEATURE_DAYS = 180;
const STALE_FEATURE_REPEAT_DAYS = 7;
const ENABLE_STALE_FEATURE_CANDIDATE_EVENTS = false;

const filterOptional = <T>(want: T[] = [], has: T[] = []) => {
  if (!want.length) return true;
  return !!intersection(want, has).length;
};

const collectMetricIds = (value: unknown, depth = 0): string[] => {
  if (depth > 4 || value === null || value === undefined) return [];
  if (typeof value === "string") {
    return value.startsWith("met_") ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectMetricIds(item, depth + 1));
  }
  if (typeof value !== "object") return [];

  const record = value as Record<string, unknown>;
  return Object.values(record).flatMap((item) =>
    collectMetricIds(item, depth + 1),
  );
};

const webhookMatchesEvent = (
  webhook: EventWebHookInterface,
  event: EventInterface,
) => {
  if (
    !webhook.events.some(
      (name) =>
        name === event.event ||
        getWildcardPatternsForEvent(event.event).includes(name),
    )
  ) {
    return false;
  }

  const filterData = getFilterDataForNotificationEvent(event.data) || {
    tags: [],
    projects: [],
  };
  if (!filterOptional(webhook.tags, filterData.tags)) return false;
  if (!filterOptional(webhook.projects, filterData.projects)) return false;
  if (
    !filterEventForEnvironments({
      event: event.data,
      environments: webhook.environments || [],
    })
  ) {
    return false;
  }
  if (
    !filterOptional(
      webhook.experiments,
      event.object === "experiment" && event.objectId ? [event.objectId] : [],
    )
  ) {
    return false;
  }
  if (!filterOptional(webhook.metrics, collectMetricIds(event.data)))
    return false;

  return true;
};

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

    const now = new Date();
    // Resolve each enabled Slack install's effective schedule (new `digest`
    // object or the legacy root `dailyDigestHourUtc`) and keep the ones whose
    // daily digest is due this hour.
    const candidates = await EventWebHookModel.find({
      enabled: true,
      payloadType: "slack",
    }).lean<EventWebHookInterface[]>();

    const webhooks = candidates.filter((w) => {
      const digest = resolveSlackDigest(w.slackOptions, {
        dailyDigestHourUtc: w.dailyDigestHourUtc,
      });
      return digest.frequency === "daily" && isSlackDigestDue(digest, now);
    });

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    for (const webhook of webhooks) {
      const events = await EventModel.find({
        organizationId: webhook.organizationId,
        dateCreated: { $gte: since },
      })
        .sort({ dateCreated: -1 })
        .limit(100)
        .lean<EventInterface[]>();
      const matchingEvents = events.filter((event) =>
        webhookMatchesEvent(webhook, event),
      );
      if (!matchingEvents.length) continue;

      const slackMessage = await buildCoalescedSlackMessage(
        matchingEvents.reverse(),
      );
      if (!slackMessage) continue;

      try {
        await cancellableFetch(
          webhook.url,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(slackMessage),
          },
          { maxTimeMs: 30000, maxContentSize: 1000 },
        );
      } catch (e) {
        logger.error(e, `Failed sending Slack daily digest for ${webhook.id}`);
      }
    }
  });

  const job = agenda.create(DAILY_DIGEST_JOB, {});
  job.unique({});
  job.repeatEvery("1 hour");
  await job.save();
}
