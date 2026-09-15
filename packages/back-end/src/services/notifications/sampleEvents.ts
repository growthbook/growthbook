// Synthetic notification events for previews and test sends.
import { DiffResult } from "shared/types/events/diff";
import { NotificationEvent } from "shared/types/events/notification-events";
import {
  ApiExperiment,
  EventUser,
  FeatureRevisionWebhookPayload,
  FeatureWebhookPayload,
  notificationEventNames,
  RampScheduleStartedPayload,
} from "shared/validators";
import { ReqContext } from "back-end/types/request";
type SampleContext = Pick<ReqContext, "userId" | "email" | "userName">;

const API_VERSION = "2024-07-31" as const;
const TEST_PROJECT = "notification-test-project";
const TEST_ENVIRONMENT = "production";
const TEST_TAG = "notification-test";

const testUser = (context: SampleContext): EventUser => ({
  type: "dashboard",
  id: context.userId || "notification-test-user",
  email: context.email || "notification-test@example.com",
  name: context.userName || "Notification Test User",
});

const nowIso = () => new Date().toISOString();
const daysAgoIso = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

const sampleFeature = (
  overrides: Partial<FeatureWebhookPayload> = {},
): FeatureWebhookPayload => ({
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
    comment: "Testing notification formatting",
    date: nowIso(),
    createdBy: "Notification Test User",
    publishedBy: "Notification Test User",
  },
  ...overrides,
});

const sampleExperiment = (
  overrides: Partial<ApiExperiment> = {},
): ApiExperiment => ({
  id: "exp_checkout_cta",
  trackingKey: "checkout-cta",
  dateCreated: nowIso(),
  dateUpdated: nowIso(),
  name: "Checkout CTA",
  type: "standard",
  project: TEST_PROJECT,
  hypothesis: "A clearer CTA will increase checkout starts",
  description: "Synthetic notification formatting test experiment",
  tags: [TEST_TAG],
  owner: "GrowthBook",
  ownerEmail: "notification-test@example.com",
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
    datasourceId: "ds_notification_test",
    assignmentQueryId: "user_id",
    experimentId: "checkout-cta",
    segmentId: "",
    queryFilter: "",
    inProgressConversions: "include",
    attributionModel: "firstExposure",
    statsEngine: "bayesian",
    regressionAdjustmentEnabled: false,
    sequentialTestingEnabled: false,
    goals: [{ metricId: "met_checkout_start", overrides: {} }],
    secondaryMetrics: [{ metricId: "met_revenue", overrides: {} }],
    guardrails: [{ metricId: "met_refund", overrides: {} }],
  },
  resultSummary: {
    status: "running",
    winner: "",
    conclusions: "",
    releasedVariationId: "",
    excludeFromPayload: false,
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

const sampleRevision = (): FeatureRevisionWebhookPayload => ({
  featureId: "checkout-banner",
  baseVersion: 2,
  version: 3,
  comment: "Adjust checkout banner copy",
  date: nowIso(),
  status: "draft",
  createdBy: "Notification Test User",
  publishedBy: "Notification Test User",
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
});

const sampleRamp = (): RampScheduleStartedPayload => ({
  rampScheduleId: "ramp_checkout_banner",
  rampName: "Checkout banner ramp",
  orgId: "org_notification_test",
  currentStepIndex: 1,
  status: "running",
});

const sampleEvents = {
  "feature.created": () => ({
    event: "feature.created",
    object: "feature",
    data: { object: sampleFeature() },
  }),
  "feature.updated": () => ({
    event: "feature.updated",
    object: "feature",
    data: {
      object: sampleFeature({
        defaultValue: "true",
        description: "Controls the checkout banner and copy treatment",
      }),
      previous_attributes: {
        defaultValue: "false",
        description: "Controls the checkout banner treatment",
      },
      changes: sampleFeatureDiff,
    },
  }),
  "feature.deleted": () => ({
    event: "feature.deleted",
    object: "feature",
    data: { object: sampleFeature({ archived: true }) },
  }),
  "feature.saferollout.ship": () => ({
    event: "feature.saferollout.ship",
    object: "feature",
    data: {
      object: {
        featureId: "checkout-banner",
        safeRolloutId: "sr_checkout_banner",
        environment: TEST_ENVIRONMENT,
      },
    },
  }),
  "feature.saferollout.rollback": () => ({
    event: "feature.saferollout.rollback",
    object: "feature",
    data: {
      object: {
        featureId: "checkout-banner",
        safeRolloutId: "sr_checkout_banner",
        environment: TEST_ENVIRONMENT,
      },
    },
  }),
  "feature.saferollout.unhealthy": () => ({
    event: "feature.saferollout.unhealthy",
    object: "feature",
    data: {
      object: {
        featureId: "checkout-banner",
        safeRolloutId: "sr_checkout_banner",
        environment: TEST_ENVIRONMENT,
        unhealthyReason: ["srm", "multipleExposures"],
      },
    },
  }),
  "feature.rampSchedule.created": () => ({
    event: "feature.rampSchedule.created",
    object: "feature",
    data: {
      object: {
        rampScheduleId: "ramp_checkout_banner",
        rampName: "Checkout banner ramp",
        orgId: "org_notification_test",
        entityType: "feature",
        entityId: "checkout-banner",
      },
    },
  }),
  "feature.rampSchedule.deleted": () => ({
    event: "feature.rampSchedule.deleted",
    object: "feature",
    data: {
      object: {
        rampScheduleId: "ramp_checkout_banner",
        rampName: "Checkout banner ramp",
        orgId: "org_notification_test",
      },
    },
  }),
  "feature.rampSchedule.actions.started": () => ({
    event: "feature.rampSchedule.actions.started",
    object: "feature",
    data: { object: sampleRamp() },
  }),
  "feature.rampSchedule.actions.completed": () => ({
    event: "feature.rampSchedule.actions.completed",
    object: "feature",
    data: { object: sampleRamp() },
  }),
  "feature.rampSchedule.actions.step.advanced": () => ({
    event: "feature.rampSchedule.actions.step.advanced",
    object: "feature",
    data: { object: sampleRamp() },
  }),
  "feature.rampSchedule.actions.rolledBack": () => ({
    event: "feature.rampSchedule.actions.rolledBack",
    object: "feature",
    data: { object: { ...sampleRamp(), targetStepIndex: 0 } },
  }),
  "feature.rampSchedule.actions.jumped": () => ({
    event: "feature.rampSchedule.actions.jumped",
    object: "feature",
    data: { object: { ...sampleRamp(), targetStepIndex: 0 } },
  }),
  "feature.rampSchedule.actions.step.approvalRequired": () => ({
    event: "feature.rampSchedule.actions.step.approvalRequired",
    object: "feature",
    data: {
      object: {
        ...sampleRamp(),
        approvalNotes: "Please confirm guardrail metrics before advancing.",
      },
    },
  }),
  "feature.revision.created": () => ({
    event: "feature.revision.created",
    object: "feature",
    data: { object: sampleRevision() },
  }),
  "feature.revision.discarded": () => ({
    event: "feature.revision.discarded",
    object: "feature",
    data: { object: sampleRevision() },
  }),
  "feature.revision.rebased": () => ({
    event: "feature.revision.rebased",
    object: "feature",
    data: { object: sampleRevision() },
  }),
  "feature.revision.published": () => ({
    event: "feature.revision.published",
    object: "feature",
    data: { object: sampleRevision() },
  }),
  "feature.revision.updated": () => ({
    event: "feature.revision.updated",
    object: "feature",
    data: {
      object: {
        ...sampleRevision(),
        change: "rule.update",
        environments: [TEST_ENVIRONMENT],
      },
    },
  }),
  "feature.revision.reviewRequested": () => ({
    event: "feature.revision.reviewRequested",
    object: "feature",
    data: {
      object: {
        ...sampleRevision(),
        reviewComment: "Ready for design review.",
      },
    },
  }),
  "feature.revision.approved": () => ({
    event: "feature.revision.approved",
    object: "feature",
    data: {
      object: {
        ...sampleRevision(),
        reviewer: {
          id: "reviewer-notification-test",
          name: "Review Bot",
          email: "review@example.com",
        },
        reviewComment: "Looks good for the test.",
      },
    },
  }),
  "feature.revision.changesRequested": () => ({
    event: "feature.revision.changesRequested",
    object: "feature",
    data: {
      object: {
        ...sampleRevision(),
        reviewer: {
          id: "reviewer-notification-test",
          name: "Review Bot",
          email: "review@example.com",
        },
        reviewComment: "Looks good for the test.",
      },
    },
  }),
  "feature.revision.commented": () => ({
    event: "feature.revision.commented",
    object: "feature",
    data: {
      object: {
        ...sampleRevision(),
        reviewer: {
          id: "reviewer-notification-test",
          name: "Review Bot",
          email: "review@example.com",
        },
        reviewComment: "Can we tighten the rollout condition?",
      },
    },
  }),
  "feature.revision.reverted": () => ({
    event: "feature.revision.reverted",
    object: "feature",
    data: {
      object: { ...sampleRevision(), revertedToVersion: 2 },
    },
  }),
  "experiment.created": () => ({
    event: "experiment.created",
    object: "experiment",
    data: { object: sampleExperiment() },
  }),
  "experiment.updated": () => ({
    event: "experiment.updated",
    object: "experiment",
    data: {
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
    },
  }),
  "experiment.deleted": () => ({
    event: "experiment.deleted",
    object: "experiment",
    data: { object: sampleExperiment({ archived: true }) },
  }),
  "experiment.warning": () => ({
    event: "experiment.warning",
    object: "experiment",
    data: {
      object: {
        type: "srm",
        experimentName: "Checkout CTA",
        experimentId: "exp_checkout_cta",
        threshold: 0.001,
      },
    },
  }),
  "experiment.info.significance": () => ({
    event: "experiment.info.significance",
    object: "experiment",
    data: {
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
      },
    },
  }),
  "experiment.decision.ship": () => ({
    event: "experiment.decision.ship",
    object: "experiment",
    data: {
      object: {
        source: "analysis",
        experimentName: "Checkout CTA",
        experimentId: "exp_checkout_cta",
        decisionDescription: "The treatment is above the decision threshold.",
      },
    },
  }),
  "experiment.decision.rollback": () => ({
    event: "experiment.decision.rollback",
    object: "experiment",
    data: {
      object: {
        source: "analysis",
        experimentName: "Checkout CTA",
        experimentId: "exp_checkout_cta",
        decisionDescription: "The treatment is underperforming the baseline.",
      },
    },
  }),
  "experiment.decision.review": () => ({
    event: "experiment.decision.review",
    object: "experiment",
    data: {
      object: {
        source: "analysis",
        experimentName: "Checkout CTA",
        experimentId: "exp_checkout_cta",
        decisionDescription:
          "The result reached power but needs stakeholder review.",
      },
    },
  }),
} satisfies Partial<{
  [Name in NotificationEvent["event"]]: () => Pick<
    Extract<NotificationEvent, { event: Name }>,
    "event" | "object" | "data"
  >;
}>;

export type SampleNotificationEventName = keyof typeof sampleEvents;

export const sampleNotificationEventNames = notificationEventNames.filter(
  (name): name is SampleNotificationEventName => name in sampleEvents,
);

export const getSampleEventPayload = ({
  context,
  eventName,
}: {
  context: SampleContext;
  eventName: SampleNotificationEventName;
}): NotificationEvent => ({
  ...sampleEvents[eventName](),
  api_version: API_VERSION,
  created: Date.now(),
  projects: [TEST_PROJECT],
  tags: [TEST_TAG],
  environments: [TEST_ENVIRONMENT],
  containsSecrets: false,
  user: testUser(context),
});
