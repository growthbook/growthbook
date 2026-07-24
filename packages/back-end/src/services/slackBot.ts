import { randomUUID } from "crypto";
import { DiffResult } from "shared/types/events/diff";
import { NotificationEvent } from "shared/types/events/notification-events";
import type { EventUser } from "shared/validators";
import {
  slackCardKindForEvent,
  SlackCardKind,
  SLACK_EVENT_OPTIONS,
} from "shared/validators";
import { ReqContext } from "back-end/types/request";
import {
  getEventWebHookById,
  getSlackBotAccessTokenForWebhook,
} from "back-end/src/models/EventWebhookModel";
import {
  getSlackMessageForNotificationEvent,
  growthbookViewLink,
  SlackMessage,
} from "back-end/src/events/handlers/slack/slack-event-handler-utils";
import {
  sampleCard,
  CardState,
  sampleScorecard,
  renderWeeklyScorecard,
  sampleFeatureDigest,
  renderFeatureDigest,
} from "back-end/src/services/slack/chartImage";
import { renderExperimentCard } from "back-end/src/services/slack/cards";
import {
  isSlackIncomingWebhookUrl,
  postSlackMessageResult,
  uploadSlackImageFile,
} from "back-end/src/services/slack/slackWebApi";
import { cancellableFetch } from "back-end/src/util/http.util";

// A test send has no real experiment, so card-worthy events render from the
// same hardcoded sample the on-page preview uses (sampleCard) rather than a DB
// lookup. Maps the event's card kind to the sample state to render.
// Human-readable label for a test event, from the settings catalog (e.g.
// "Decision ready", "Reached significance") — falls back to the raw event name.
const friendlyTestEventLabel = (eventName: string): string =>
  SLACK_EVENT_OPTIONS.find((o) => o.events.includes(eventName))?.label ??
  eventName;

const TEST_CARD_STATE: Record<SlackCardKind, CardState> = {
  started: "started",
  significance: "running",
  won: "winner",
  lost: "loser",
  stopped: "stopped",
  warning: "warning",
  decisionShip: "winner",
  decisionRollback: "loser",
};

export const slackEventWebhookTestEventNames = [
  "feature.created",
  "feature.updated",
  "feature.deleted",
  "feature.saferollout.ship",
  "feature.saferollout.rollback",
  "feature.saferollout.unhealthy",
  "feature.stale.candidate",
  "feature.rampSchedule.created",
  "feature.rampSchedule.deleted",
  "feature.rampSchedule.actions.started",
  "feature.rampSchedule.actions.completed",
  "feature.rampSchedule.actions.rolledBack",
  "feature.rampSchedule.actions.jumped",
  "feature.rampSchedule.actions.step.advanced",
  "feature.rampSchedule.actions.step.approvalRequired",
  "feature.revision.created",
  "feature.revision.updated",
  "feature.revision.reviewRequested",
  "feature.revision.approved",
  "feature.revision.changesRequested",
  "feature.revision.commented",
  "feature.revision.discarded",
  "feature.revision.rebased",
  "feature.revision.published",
  "feature.revision.reverted",
  "experiment.created",
  "experiment.updated",
  "experiment.deleted",
  "experiment.warning",
  "experiment.info.significance",
  "experiment.decision.ship",
  "experiment.decision.rollback",
  "experiment.decision.review",
  "experiment.started",
  "experiment.stopped.shipped",
  "experiment.stopped.rolledback",
  "experiment.health.guardrailFailed",
  "experiment.health.noData",
  "experiment.health.queryFailed",
  "experiment.status.changed",
  "experiment.endingSoon",
  "experiment.stale",
  "experiment.metric.regression",
  "experiment.bandit.weightsChanged",
  "experiment.holdout.created",
  "experiment.holdout.updated",
] as const;

export type SlackEventWebhookTestEventName =
  (typeof slackEventWebhookTestEventNames)[number];

export type SlackEventWebhookTestResult =
  | {
      ok: true;
      eventId: string;
      eventWebHookId: string;
      eventName: SlackEventWebhookTestEventName;
      slackMessage: SlackMessage;
    }
  | { ok: false; error: string };

export type SlackEventWebhookPreview = {
  eventName: SlackEventWebhookTestEventName;
  slackMessage: SlackMessage;
};

export type SlackEventWebhookPreviewsResult =
  | {
      ok: true;
      previews: SlackEventWebhookPreview[];
    }
  | { ok: false; error: string };

const API_VERSION = "2024-07-31" as const;
const TEST_PROJECT = "slack-test-project";
const TEST_ENVIRONMENT = "production";
const TEST_TAG = "slack-test";

const isSlackEventWebhookTestEventName = (
  eventName: string,
): eventName is SlackEventWebhookTestEventName =>
  slackEventWebhookTestEventNames.includes(
    eventName as SlackEventWebhookTestEventName,
  );

const testUser = (context: ReqContext): EventUser => ({
  type: "dashboard",
  id: context.userId || "slack-test-user",
  email: context.email || "slack-test@example.com",
  name: context.userName || "Slack Test User",
});

const nowIso = () => new Date().toISOString();
const daysAgoIso = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

const testEventUserLabel = (context: ReqContext): string => {
  const name = context.userName || "Slack Test User";
  const email = context.email || "slack-test@example.com";

  return `${name} (${email})`;
};

const sampleFeature = (overrides: Record<string, unknown> = {}) => ({
  id: "checkout-banner",
  dateCreated: nowIso(),
  dateUpdated: nowIso(),
  archived: false,
  description: "Controls the checkout banner treatment",
  owner: "GrowthBook",
  project: TEST_PROJECT,
  valueType: "boolean",
  defaultValue: "false",
  tags: [TEST_TAG],
  environments: {
    [TEST_ENVIRONMENT]: {
      enabled: true,
      defaultValue: "false",
      rules: [
        {
          id: "rule-rollout",
          type: "rollout",
          value: "true",
          coverage: 0.5,
          condition: '{"country":"US"}',
        },
      ],
    },
  },
  prerequisites: [],
  revision: {
    version: 3,
    comment: "Testing Slack formatting",
    date: nowIso(),
    createdBy: "Slack Test User",
    publishedBy: "Slack Test User",
  },
  ...overrides,
});

const sampleExperiment = (overrides: Record<string, unknown> = {}) => ({
  id: "exp_checkout_cta",
  trackingKey: "checkout-cta",
  dateCreated: nowIso(),
  dateUpdated: nowIso(),
  name: "Checkout CTA",
  type: "standard",
  project: TEST_PROJECT,
  hypothesis: "A clearer CTA will increase checkout starts",
  description: "Synthetic Slack formatting test experiment",
  tags: [TEST_TAG],
  owner: "GrowthBook",
  ownerEmail: "slack-test@example.com",
  archived: false,
  status: "running",
  autoRefresh: true,
  hashAttribute: "id",
  hashVersion: 2,
  variations: [
    {
      variationId: "var_control",
      key: "control",
      name: "Control",
      description: "Existing CTA",
      screenshots: [],
    },
    {
      variationId: "var_treatment",
      key: "treatment",
      name: "Treatment",
      description: "High contrast CTA",
      screenshots: [],
    },
  ],
  phases: [
    {
      name: "Main phase",
      dateStarted: daysAgoIso(204),
      dateEnded: "",
      reasonForStopping: "",
      seed: "checkout-cta",
      coverage: 0.8,
      trafficSplit: [
        { variationId: "var_control", weight: 0.5 },
        { variationId: "var_treatment", weight: 0.5 },
      ],
      targetingCondition: "",
    },
  ],
  settings: {
    datasourceId: "ds_slack_test",
    assignmentQueryId: "user_id",
    experimentId: "checkout-cta",
    segmentId: "",
    queryFilter: "",
    inProgressConversions: "loose",
    attributionModel: "firstExposure",
    statsEngine: "bayesian",
    regressionAdjustmentEnabled: false,
    sequentialTestingEnabled: false,
    goals: ["met_checkout_start"],
    secondaryMetrics: ["met_revenue"],
    guardrails: ["met_refund"],
  },
  resultSummary: {
    status: "running",
    winner: "",
    conclusions: "",
    releasedVariationId: "",
    excludeFromPayload: false,
  },
  analysisSummary: {
    health: {
      srm: 0.72,
      multipleExposures: 0,
      totalUsers: 48700,
    },
  },
  ...overrides,
});

const sampleFeatureDiff: DiffResult = {
  added: {},
  removed: {},
  modified: [
    {
      key: "defaultValue",
      oldValue: "false",
      newValue: "true",
    },
    {
      key: "description",
      oldValue: "Controls the checkout banner treatment",
      newValue: "Controls the checkout banner and copy treatment",
    },
  ],
};

const sampleExperimentDiff: DiffResult = {
  added: {},
  removed: {},
  modified: [
    {
      key: "status",
      oldValue: "draft",
      newValue: "running",
    },
    {
      key: "resultSummary",
      oldValue: {
        status: "running",
        winner: "",
        conclusions: "",
        releasedVariationId: "",
        excludeFromPayload: false,
      },
      newValue: {
        status: "ship-now",
        winner: "var_treatment",
        conclusions: "Treatment increased checkout starts.",
        releasedVariationId: "var_treatment",
        excludeFromPayload: false,
      },
    },
  ],
};

const sampleRevision = (overrides: Record<string, unknown> = {}) => ({
  featureId: "checkout-banner",
  baseVersion: 2,
  version: 3,
  comment: "Adjust checkout banner copy",
  date: nowIso(),
  status: "draft",
  createdBy: "Slack Test User",
  publishedBy: "Slack Test User",
  defaultValue: "false",
  rules: {
    [TEST_ENVIRONMENT]: [
      {
        id: "rule-rollout",
        type: "rollout",
        value: "true",
        coverage: 0.5,
      },
    ],
  },
  definitions: { [TEST_ENVIRONMENT]: "false" },
  environmentsEnabled: { [TEST_ENVIRONMENT]: true },
  prerequisites: [],
  ...overrides,
});

const sampleRamp = (overrides: Record<string, unknown> = {}) => ({
  rampScheduleId: "ramp_checkout_banner",
  rampName: "Checkout banner ramp",
  orgId: "org_slack_test",
  currentStepIndex: 1,
  status: "running",
  ...overrides,
});

const getSampleEventData = (eventName: SlackEventWebhookTestEventName) => {
  switch (eventName) {
    case "feature.created":
      return { object: sampleFeature() };
    case "feature.updated":
      return {
        object: sampleFeature({
          defaultValue: "true",
          description: "Controls the checkout banner and copy treatment",
        }),
        previous_attributes: {
          defaultValue: "false",
          description: "Controls the checkout banner treatment",
        },
        changes: sampleFeatureDiff,
      };
    case "feature.deleted":
      return { object: sampleFeature({ archived: true }) };
    case "feature.saferollout.ship":
    case "feature.saferollout.rollback":
      return {
        object: {
          featureId: "checkout-banner",
          safeRolloutId: "sr_checkout_banner",
          environment: TEST_ENVIRONMENT,
        },
      };
    case "feature.saferollout.unhealthy":
      return {
        object: {
          featureId: "checkout-banner",
          safeRolloutId: "sr_checkout_banner",
          environment: TEST_ENVIRONMENT,
          unhealthyReason: ["srm", "multipleExposures"],
        },
      };
    case "feature.stale.candidate":
      return {
        object: {
          featureId: "checkout-banner",
          featureName: "Checkout banner",
          daysSinceLastUpdate: 212,
          reason:
            "This flag has not been updated recently and may be ready to remove from code.",
        },
      };
    case "feature.rampSchedule.created":
      return {
        object: {
          rampScheduleId: "ramp_checkout_banner",
          rampName: "Checkout banner ramp",
          orgId: "org_slack_test",
          entityType: "feature",
          entityId: "checkout-banner",
        },
      };
    case "feature.rampSchedule.deleted":
      return {
        object: {
          rampScheduleId: "ramp_checkout_banner",
          rampName: "Checkout banner ramp",
          orgId: "org_slack_test",
        },
      };
    case "feature.rampSchedule.actions.started":
    case "feature.rampSchedule.actions.completed":
    case "feature.rampSchedule.actions.step.advanced":
      return { object: sampleRamp() };
    case "feature.rampSchedule.actions.rolledBack":
    case "feature.rampSchedule.actions.jumped":
      return { object: sampleRamp({ targetStepIndex: 0 }) };
    case "feature.rampSchedule.actions.step.approvalRequired":
      return {
        object: sampleRamp({
          approvalNotes: "Please confirm guardrail metrics before advancing.",
        }),
      };
    case "feature.revision.created":
    case "feature.revision.discarded":
    case "feature.revision.rebased":
    case "feature.revision.published":
      return { object: sampleRevision() };
    case "feature.revision.updated":
      return {
        object: sampleRevision({
          change: "rule.update",
          environments: [TEST_ENVIRONMENT],
        }),
      };
    case "feature.revision.reviewRequested":
      return {
        object: sampleRevision({
          reviewComment: "Ready for design review.",
        }),
      };
    case "feature.revision.approved":
    case "feature.revision.changesRequested":
      return {
        object: sampleRevision({
          reviewer: {
            id: "reviewer-slack-test",
            name: "Review Bot",
            email: "review@example.com",
          },
          reviewComment: "Looks good for the test.",
        }),
      };
    case "feature.revision.commented":
      return {
        object: sampleRevision({
          reviewer: {
            id: "reviewer-slack-test",
            name: "Review Bot",
            email: "review@example.com",
          },
          reviewComment: "Can we tighten the rollout condition?",
        }),
      };
    case "feature.revision.reverted":
      return {
        object: sampleRevision({
          revertedToVersion: 2,
        }),
      };
    case "experiment.created":
      return { object: sampleExperiment() };
    case "experiment.updated":
      return {
        object: sampleExperiment({
          resultSummary: {
            status: "ship-now",
            winner: "var_treatment",
            conclusions: "Treatment increased checkout starts.",
            releasedVariationId: "var_treatment",
            excludeFromPayload: false,
          },
        }),
        previous_attributes: {
          status: "draft",
          resultSummary: {
            status: "running",
            winner: "",
            conclusions: "",
            releasedVariationId: "",
            excludeFromPayload: false,
          },
        },
        changes: sampleExperimentDiff,
      };
    case "experiment.deleted":
      return { object: sampleExperiment({ archived: true }) };
    case "experiment.warning":
      return {
        object: {
          type: "multiple-exposures",
          experimentName: "Checkout CTA",
          experimentId: "exp_checkout_cta",
          usersCount: 125,
          percent: 0.08,
        },
      };
    case "experiment.info.significance":
      return {
        object: {
          experimentName: "Checkout CTA",
          experimentId: "exp_checkout_cta",
          variationId: "var_treatment",
          variationName: "Treatment",
          metricName: "Checkout starts",
          metricId: "met_checkout_start",
          statsEngine: "bayesian",
          criticalValue: 0.97,
          winning: true,
          metricRole: "goal",
          uplift: 0.042,
          ci: [0.011, 0.075],
        },
      };
    case "experiment.decision.ship":
      return {
        object: {
          experimentName: "Checkout CTA",
          experimentId: "exp_checkout_cta",
          decisionDescription: "The treatment is above the decision threshold.",
        },
      };
    case "experiment.decision.rollback":
      return {
        object: {
          experimentName: "Checkout CTA",
          experimentId: "exp_checkout_cta",
          decisionDescription: "The treatment is underperforming the baseline.",
        },
      };
    case "experiment.decision.review":
      return {
        object: {
          experimentName: "Checkout CTA",
          experimentId: "exp_checkout_cta",
          decisionDescription:
            "The result reached power but needs stakeholder review.",
        },
      };
    case "experiment.started":
      return {
        object: {
          type: "started",
          experimentName: "Checkout CTA",
          experimentId: "exp_checkout_cta",
          phaseName: "Main phase",
          variationCount: 2,
        },
      };
    case "experiment.stopped.shipped":
      return {
        object: {
          type: "shipped",
          experimentName: "Checkout CTA",
          experimentId: "exp_checkout_cta",
          results: "won",
          releasedVariationName: "Treatment",
          enableTemporaryRollout: true,
          reason: "Treatment increased checkout starts.",
        },
      };
    case "experiment.stopped.rolledback":
      return {
        object: {
          type: "rolledback",
          experimentName: "Checkout CTA",
          experimentId: "exp_checkout_cta",
          results: "lost",
          releasedVariationName: "Control",
          enableTemporaryRollout: false,
          reason: "Guardrails failed during review.",
        },
      };
    case "experiment.health.guardrailFailed":
      return {
        object: {
          type: "guardrail-failed",
          experimentName: "Checkout CTA",
          experimentId: "exp_checkout_cta",
          failedMetrics: [
            {
              id: "met_refund",
              name: "Refund rate",
              variationName: "Treatment",
            },
          ],
        },
      };
    case "experiment.health.noData":
      return {
        object: {
          type: "no-data",
          experimentName: "Checkout CTA",
          experimentId: "exp_checkout_cta",
        },
      };
    case "experiment.health.queryFailed":
      return {
        object: {
          type: "query-failed",
          experimentName: "Checkout CTA",
          experimentId: "exp_checkout_cta",
          errorMessage: "Column user_id was not found in exposure query.",
        },
      };
    case "experiment.status.changed":
      return {
        object: {
          type: "status-changed",
          experimentName: "Checkout CTA",
          experimentId: "exp_checkout_cta",
          previousStatus: "draft",
          currentStatus: "running",
        },
      };
    case "experiment.endingSoon":
      return {
        object: {
          type: "ending-soon",
          experimentName: "Checkout CTA",
          experimentId: "exp_checkout_cta",
          endsAt: nowIso(),
          daysRemaining: 2,
        },
      };
    case "experiment.stale":
      return {
        object: {
          type: "stale",
          experimentName: "Checkout CTA",
          experimentId: "exp_checkout_cta",
          daysRunning: 127,
          reason:
            "This experiment has been running for a long time. Review whether it should ship, roll back, or be extended.",
        },
      };
    case "experiment.metric.regression":
      return {
        object: {
          type: "metric-regression",
          experimentName: "Checkout CTA",
          experimentId: "exp_checkout_cta",
          variationName: "Treatment",
          metricName: "Refund rate",
          metricId: "met_refund",
          metricRole: "guardrail",
          uplift: 0.083,
          ci: [0.031, 0.129],
        },
      };
    case "experiment.bandit.weightsChanged":
      return {
        object: {
          type: "bandit-weights-changed",
          experimentName: "Checkout CTA",
          experimentId: "exp_checkout_cta",
          currentWeights: [0.5, 0.5],
          updatedWeights: [0.2, 0.8],
        },
      };
    case "experiment.holdout.created":
      return {
        object: {
          type: "holdout-created",
          experimentName: "Checkout CTA Holdout",
          experimentId: "exp_checkout_cta_holdout",
        },
      };
    case "experiment.holdout.updated":
      return {
        object: {
          type: "holdout-updated",
          experimentName: "Checkout CTA Holdout",
          experimentId: "exp_checkout_cta_holdout",
        },
      };
  }
};

const getSampleEventPayload = ({
  context,
  eventName,
}: {
  context: ReqContext;
  eventName: SlackEventWebhookTestEventName;
}): NotificationEvent => {
  const [object] = eventName.split(".") as ["feature" | "experiment"];

  return {
    event: eventName,
    object,
    api_version: API_VERSION,
    created: Date.now(),
    data: getSampleEventData(eventName),
    projects: [TEST_PROJECT],
    tags: [TEST_TAG],
    environments: [TEST_ENVIRONMENT],
    containsSecrets: false,
    user: testUser(context),
  } as NotificationEvent;
};

const getSlackMessageRenderContext = ({
  context,
  eventPayload,
}: {
  context: ReqContext;
  eventPayload: NotificationEvent;
}) => ({
  eventUser: testEventUserLabel(context),
  organizationId: context.org.id,
  event: eventPayload,
  experimentDetails: sampleExperiment(),
});

export const getSlackEventWebhookTestPreviews = async ({
  context,
}: {
  context: ReqContext;
}): Promise<SlackEventWebhookPreviewsResult> => {
  const previews = await Promise.all(
    slackEventWebhookTestEventNames.map(async (eventName) => {
      const eventPayload = getSampleEventPayload({ context, eventName });
      const slackMessage = await getSlackMessageForNotificationEvent(
        eventPayload,
        `preview-${eventName}`,
        getSlackMessageRenderContext({ context, eventPayload }),
      );

      if (!slackMessage) {
        throw new Error(`Unable to preview Slack event: ${eventName}`);
      }

      return {
        eventName,
        slackMessage,
      };
    }),
  );

  return {
    ok: true,
    previews,
  };
};

export const sendSlackEventWebhookTestEvent = async ({
  context,
  eventWebHookId,
  eventName,
}: {
  context: ReqContext;
  eventWebHookId: string;
  eventName: string;
}): Promise<SlackEventWebhookTestResult> => {
  if (!isSlackEventWebhookTestEventName(eventName)) {
    return { ok: false, error: `Unsupported Slack test event: ${eventName}` };
  }

  const eventWebHook = await getEventWebHookById(
    eventWebHookId,
    context.org.id,
  );
  if (!eventWebHook) {
    return { ok: false, error: "Event webhook not found" };
  }

  if (eventWebHook.payloadType !== "slack") {
    return {
      ok: false,
      error: "Select an Event Webhook with Slack payload type",
    };
  }

  const eventId = `slack-test-${randomUUID()}`;
  const eventPayload = getSampleEventPayload({ context, eventName });

  const slackMessage = await getSlackMessageForNotificationEvent(
    eventPayload,
    eventId,
    getSlackMessageRenderContext({ context, eventPayload }),
  );

  if (!slackMessage) {
    return { ok: false, error: `Unable to preview Slack event: ${eventName}` };
  }

  // Deliver the sample straight to Slack WITHOUT persisting an Event — a test
  // send is a preview, and a real Event would pollute the events feed and
  // inflate digest counts. Mirrors the real delivery path (bot-token card
  // upload, or text via the incoming-webhook URL) minus the Event bookkeeping.
  const botToken = await getSlackBotAccessTokenForWebhook({
    eventWebHookId,
    organizationId: context.org.id,
  });
  const channelId = eventWebHook.slack?.channelId;

  const format = eventWebHook.slackOptions?.experimentCardFormat ?? "compact";
  const cardKind = slackCardKindForEvent(eventName);
  // Preamble posted just before the sample, so it's obvious in-channel that
  // the following card/message is a test (only on the test-send path).
  const preamble = `Testing *${friendlyTestEventLabel(
    eventName,
  )}*. This is a test message.`;

  try {
    if (botToken && channelId) {
      await postSlackMessageResult({
        token: botToken,
        channel: channelId,
        text: preamble,
        unfurl: false,
      });
      if (format !== "none" && cardKind) {
        // Render the sample card (no DB — the test experiment isn't real) and
        // upload it privately, exactly as a real card-worthy event would.
        const card = sampleCard(TEST_CARD_STATE[cardKind]);
        card.event = cardKind;
        const png = await renderExperimentCard(
          card,
          format === "detailed" ? "detailed" : "compact",
        );
        const fileId = await uploadSlackImageFile({
          token: botToken,
          png,
          title: `${card.name} — test`,
          filename: "experiment-card.png",
          channelId,
          // Sample card uses a fictional experiment, so link to the list.
          initialComment: growthbookViewLink(
            "/experiments",
            "View experiments in GrowthBook",
          ),
        });
        if (!fileId) {
          return { ok: false, error: "Slack file upload failed" };
        }
      } else {
        const result = await postSlackMessageResult({
          token: botToken,
          channel: channelId,
          text: slackMessage.text,
          blocks: slackMessage.blocks as unknown as Record<string, unknown>[],
          unfurl: false,
        });
        if (!result.ok) {
          return { ok: false, error: `Slack delivery failed: ${result.error}` };
        }
      }
    } else {
      // No bot token — text-only via the incoming-webhook URL (never a public
      // card image URL), legacy installs only. Workspace-level installs store
      // a placeholder url that must never be POSTed.
      if (!isSlackIncomingWebhookUrl(eventWebHook.url)) {
        return {
          ok: false,
          error:
            "This Slack connection has no bot token. Reconnect the workspace from Settings → Slack.",
        };
      }
      await cancellableFetch(
        eventWebHook.url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: preamble }),
        },
        { maxTimeMs: 30000, maxContentSize: 1000 },
      );
      const { responseWithoutBody } = await cancellableFetch(
        eventWebHook.url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(slackMessage),
        },
        { maxTimeMs: 30000, maxContentSize: 1000 },
      );
      if (!responseWithoutBody.ok) {
        return {
          ok: false,
          error: `Slack delivery failed: ${responseWithoutBody.statusText}`,
        };
      }
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to send test message",
    };
  }

  return {
    ok: true,
    eventId,
    eventWebHookId,
    eventName,
    slackMessage,
  };
};

export type SlackTestDigestKind = "scorecard" | "feature";

export type SlackTestDigestResult = { ok: true } | { ok: false; error: string };

// Post a sample digest (experiment scorecard or feature-flag summary) to the
// channel. Digests are image-only, rendered from the same sample data as the
// on-page preview, and uploaded privately — so a bot token + channel is
// required (there's no text form to fall back to via the incoming-webhook URL).
export const sendSlackEventWebhookTestDigest = async ({
  context,
  eventWebHookId,
  digest,
}: {
  context: ReqContext;
  eventWebHookId: string;
  digest: SlackTestDigestKind;
}): Promise<SlackTestDigestResult> => {
  const eventWebHook = await getEventWebHookById(
    eventWebHookId,
    context.org.id,
  );
  if (!eventWebHook) {
    return { ok: false, error: "Event webhook not found" };
  }
  if (eventWebHook.payloadType !== "slack") {
    return {
      ok: false,
      error: "Select an Event Webhook with Slack payload type",
    };
  }

  const botToken = await getSlackBotAccessTokenForWebhook({
    eventWebHookId,
    organizationId: context.org.id,
  });
  const channelId = eventWebHook.slack?.channelId;
  if (!botToken || !channelId) {
    return {
      ok: false,
      error:
        "Reconnect this channel with a bot token to send digest previews — they post as an uploaded image.",
    };
  }

  const label =
    digest === "scorecard" ? "experiment scorecard" : "feature-flag";

  try {
    await postSlackMessageResult({
      token: botToken,
      channel: channelId,
      text: `Testing the *${label} digest*. This is a test message.`,
      unfurl: false,
    });
    const png =
      digest === "scorecard"
        ? await renderWeeklyScorecard(sampleScorecard())
        : await renderFeatureDigest(sampleFeatureDigest());
    const fileId = await uploadSlackImageFile({
      token: botToken,
      png,
      title:
        digest === "scorecard"
          ? "Experiment scorecard — test"
          : "Feature-flag digest — test",
      filename: `${digest}-digest.png`,
      channelId,
      initialComment:
        digest === "scorecard"
          ? growthbookViewLink("/experiments", "View experiments in GrowthBook")
          : growthbookViewLink("/features", "View feature flags in GrowthBook"),
    });
    if (!fileId) {
      return { ok: false, error: "Slack file upload failed" };
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to send digest",
    };
  }

  return { ok: true };
};
