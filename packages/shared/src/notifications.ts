import type { NotificationEventName } from "../types/events/base-types";

export interface NotificationEventMetadata {
  label: string;
  // Full sentence for the generated webhook docs. The UI never shows it.
  description: string;
  // Optional line under the checkbox label in notification settings.
  subtitle?: string;
  internal?: boolean;
  preview?: true;
  // A producer may still return text for unsupported event subtypes.
  supportsCard?: true;
}

export const notificationEventMetadata = {
  "feature.created": {
    label: "Created",
    description: "Triggered when a feature is created",
    preview: true,
  },
  "feature.updated": {
    label: "Updated",
    description: "Triggered when a feature is updated",
    subtitle: "Any change, including publishes and metadata edits.",
    preview: true,
  },
  "feature.deleted": {
    label: "Deleted",
    description: "Triggered when a feature is deleted",
    preview: true,
  },
  "feature.saferollout.ship": {
    label: "Safe rollout ready to ship",
    description:
      "Triggered when a safe rollout is completed and safe to rollout to 100%.",
    preview: true,
  },
  "feature.saferollout.rollback": {
    label: "Safe rollout should roll back",
    description:
      "Triggered when a safe rollout has a failing guardrail and should be reverted.",
    preview: true,
  },
  "feature.saferollout.unhealthy": {
    label: "Safe rollout unhealthy",
    description:
      "Triggered when a safe rollout is failing a health check and may not be working as expected.",
    preview: true,
  },
  "feature.rampSchedule.created": {
    label: "Ramp schedule created",
    description: "Triggered when a ramp schedule is created for a feature",
    preview: true,
  },
  "feature.rampSchedule.deleted": {
    label: "Ramp schedule deleted",
    description: "Triggered when a ramp schedule is deleted from a feature",
    preview: true,
  },
  "feature.rampSchedule.actions.started": {
    label: "Ramp schedule started",
    description: "Triggered when a feature ramp schedule starts",
    preview: true,
  },
  "feature.rampSchedule.actions.completed": {
    label: "Ramp schedule completed",
    description: "Triggered when a feature ramp schedule completes all steps",
    preview: true,
  },
  "feature.rampSchedule.actions.rolledBack": {
    label: "Ramp schedule rolled back",
    description:
      "Triggered when a feature ramp schedule is rolled back or reset to start",
    preview: true,
  },
  "feature.rampSchedule.actions.jumped": {
    label: "Ramp schedule jumped to step",
    description:
      "Triggered when a feature ramp schedule is jumped to a specific step",
    preview: true,
  },
  "feature.rampSchedule.actions.step.advanced": {
    label: "Ramp schedule advanced",
    description:
      "Triggered when a feature ramp schedule advances. Overdue steps are caught up in a single advance: when `currentStepIndex - previousStepIndex > 1`, the intermediate steps were folded into this one event (one revision publish) rather than fired individually.",
    preview: true,
  },
  "feature.rampSchedule.actions.step.approvalRequired": {
    label: "Ramp step approval requested",
    description: "Triggered when a feature ramp step is waiting for approval",
    preview: true,
  },
  "feature.rampSchedule.actions.awaitingStartApproval": {
    label: "Ramp start approval requested",
    description:
      "Triggered when a feature ramp schedule is published but held at the start, awaiting an explicit start approval",
  },
  "feature.rampSchedule.actions.startApproved": {
    label: "Ramp start approved",
    description:
      "Triggered when a held ramp schedule's start is approved by a user",
  },
  "feature.rampSchedule.actions.errorPaused": {
    label: "Ramp schedule paused on error",
    description:
      "Triggered when a feature ramp schedule pauses because a step could not be applied, for example a plan the engine refuses; `reason` says why",
    preview: true,
  },
  "feature.revision.created": {
    label: "New draft revision",
    description: "Triggered when a new draft revision is created for a feature",
    preview: true,
  },
  "feature.revision.updated": {
    label: "Draft edited",
    description:
      "Triggered when a draft revision is modified (rules, default value, toggles, prerequisites, metadata, etc.). The `change` field indicates the specific kind of mutation.",
    subtitle: "Every edit to a draft.",
    preview: true,
  },
  "feature.revision.reviewRequested": {
    label: "Review requested",
    description: "Triggered when a draft revision is submitted for review",
    preview: true,
  },
  "feature.revision.approved": {
    label: "Draft approved",
    description: "Triggered when a draft revision is approved by a reviewer",
    preview: true,
  },
  "feature.revision.changesRequested": {
    label: "Changes requested",
    description:
      "Triggered when a reviewer requests changes on a draft revision",
    preview: true,
  },
  "feature.revision.commented": {
    label: "Comment on draft",
    description: "Triggered when a comment is added to a draft revision",
    preview: true,
  },
  "feature.revision.discarded": {
    label: "Draft discarded",
    description: "Triggered when a draft revision is discarded",
    preview: true,
  },
  "feature.revision.reopened": {
    label: "Discarded draft reopened",
    description:
      "Triggered when a discarded draft revision is reopened as a draft",
  },
  "feature.revision.recalled": {
    label: "Review request withdrawn",
    description:
      "Triggered when the author (or an editor) recalls a review request, returning the revision to `draft`. Distinct from `revision.reopened`, which restores a discarded revision.",
    subtitle: "The author withdraws a review request. The draft stays open.",
  },
  "feature.revision.reviewRetracted": {
    label: "Review retracted",
    description:
      "Triggered when a reviewer retracts their own verdict. The status is recomputed from the verdicts that remain, so the revision may end up `pending-review`, or stay `approved` or `changes-requested` when another reviewer's verdict still stands. Carries no content change — the revision's proposed changes are untouched.",
    subtitle: "A reviewer withdraws their own approval or change request.",
  },
  "feature.revision.publishScheduleChanged": {
    label: "Publish schedule changed",
    description:
      "Triggered when a deferred publish is armed, re-armed, or cancelled on a revision. Carries no content change.",
    subtitle: "A scheduled publish is set, moved, or cancelled.",
  },
  "feature.revision.rebased": {
    label: "Draft rebased",
    description:
      "Triggered when a draft revision is rebased onto the latest published version",
    subtitle: "The draft is moved onto the latest live version.",
    preview: true,
  },
  "feature.revision.published": {
    label: "New version published",
    description:
      "Triggered when a draft revision is published. Overlaps with `feature.updated` but provides revision-specific context (base version, comment, author).",
    subtitle: "A draft becomes the live version.",
    preview: true,
  },
  "feature.revision.reverted": {
    label: "Reverted to previous version",
    description:
      "Triggered when a feature is reverted to a previous published revision",
    preview: true,
  },
  "feature.revision.publishFailed": {
    label: "Scheduled publishing failed",
    description:
      "Triggered when a deferred publish (scheduled publish or auto-publish-on-approval) is given up on after failing — terminally, or after exhausting retries. The draft is left open for a human to resolve.",
    subtitle:
      "A scheduled or automatic publish failed and won't retry. The draft stays open.",
  },
  "experiment.created": {
    label: "New experiment (draft)",
    description: "Triggered when an experiment is created",
    preview: true,
  },
  "experiment.updated": {
    label: "Experiment edited",
    description: "Triggered when an experiment is updated",
    preview: true,
  },
  "experiment.deleted": {
    label: "Experiment deleted",
    description: "Triggered when an experiment is deleted",
    preview: true,
  },
  "experiment.warning": {
    label: "Warnings",
    description:
      "Triggered when a warning condition is detected on an experiment",
    subtitle:
      "SRM, multiple exposures, no data, underpowered results, or failed updates.",
    preview: true,
    supportsCard: true,
  },
  "experiment.info.significance": {
    label: "Reached significance",
    description:
      "Triggered when a goal or guardrail metric reaches significance in an experiment (e.g. either above 95% or below 5% chance to win). Be careful using this without Sequential Testing as it can lead to peeking problems.",
    subtitle:
      "A metric reaches significance. Use Sequential Testing to avoid peeking.",
    preview: true,
  },
  "experiment.info.scheduled-status-update": {
    label: "Scheduled start or stop applied",
    description:
      "Triggered when a scheduled start or stop is automatically applied to an experiment, including the auto-ship outcome for a scheduled end.",
    subtitle:
      "Includes the automatic ship outcome when an experiment ends on schedule.",
  },
  "experiment.decision.ship": {
    label: "Ready to ship",
    description: "Triggered when an experiment is ready to ship a variation.",
    preview: true,
  },
  "experiment.decision.rollback": {
    label: "Ready to roll back",
    description:
      "Triggered when an experiment should be rolled back to the control.",
    preview: true,
  },
  "experiment.decision.review": {
    label: "Ready for review",
    description:
      "Triggered when an experiment has reached the desired power point, but the results may be ambiguous.",
    preview: true,
  },
  "savedGroup.created": {
    label: "Created",
    description: "Triggered when a saved group is created",
  },
  "savedGroup.updated": {
    label: "Updated",
    description: "Triggered when a saved group is updated",
    subtitle: "Any change, including publishes and metadata edits.",
  },
  "savedGroup.deleted": {
    label: "Deleted",
    description: "Triggered when a saved group is deleted",
  },
  "savedGroup.revision.created": {
    label: "New draft revision",
    description:
      "Triggered when a new draft revision is created for a saved group",
  },
  "savedGroup.revision.updated": {
    label: "Draft edited",
    description:
      "Triggered when a draft revision's proposed changes are modified (values, condition, archive, or metadata). The `change` field indicates the kind of mutation.",
    subtitle: "Every edit to a draft.",
  },
  "savedGroup.revision.reviewRequested": {
    label: "Review requested",
    description: "Triggered when a draft revision is submitted for review",
  },
  "savedGroup.revision.approved": {
    label: "Draft approved",
    description: "Triggered when a draft revision is approved by a reviewer",
  },
  "savedGroup.revision.changesRequested": {
    label: "Changes requested",
    description:
      "Triggered when a reviewer requests changes on a draft revision",
  },
  "savedGroup.revision.commented": {
    label: "Comment on draft",
    description: "Triggered when a comment is added to a draft revision",
  },
  "savedGroup.revision.discarded": {
    label: "Draft discarded",
    description: "Triggered when a draft revision is discarded",
  },
  "savedGroup.revision.rebased": {
    label: "Draft rebased",
    description:
      "Triggered when a draft revision is rebased onto the latest live state",
    subtitle: "The draft is moved onto the latest live version.",
  },
  "savedGroup.revision.published": {
    label: "New version published",
    description:
      "Triggered when a draft revision is published. Overlaps with `savedGroup.updated` but provides revision-specific context.",
    subtitle: "A draft becomes the live version.",
  },
  "savedGroup.revision.reverted": {
    label: "Reverted to previous version",
    description:
      "Triggered when a saved group is reverted to a previous published revision",
  },
  "savedGroup.revision.reopened": {
    label: "Discarded draft reopened",
    description: "Triggered when a discarded revision is reopened",
  },
  "savedGroup.revision.recalled": {
    label: "Review request withdrawn",
    description:
      "Triggered when the author (or an editor) recalls a review request, returning the revision to `draft`. Distinct from `revision.reopened`, which restores a discarded revision.",
    subtitle: "The author withdraws a review request. The draft stays open.",
  },
  "savedGroup.revision.reviewRetracted": {
    label: "Review retracted",
    description:
      "Triggered when a reviewer retracts their own verdict. The status is recomputed from the verdicts that remain, so the revision may end up `pending-review`, or stay `approved` or `changes-requested` when another reviewer's verdict still stands. Carries no content change — the revision's proposed changes are untouched.",
    subtitle: "A reviewer withdraws their own approval or change request.",
  },
  "savedGroup.revision.publishScheduleChanged": {
    label: "Publish schedule changed",
    description:
      "Triggered when a deferred publish is armed, re-armed, or cancelled on a revision. Carries no content change.",
    subtitle: "A scheduled publish is set, moved, or cancelled.",
  },
  "savedGroup.revision.publishFailed": {
    label: "Scheduled publishing failed",
    description:
      "Triggered when a deferred publish (scheduled publish or auto-publish-on-approval) is given up on after failing — terminally, or after exhausting retries. The draft is left open for a human to resolve.",
    subtitle:
      "A scheduled or automatic publish failed and won't retry. The draft stays open.",
  },
  "constant.created": {
    label: "Created",
    description: "Triggered when a constant is created",
  },
  "constant.updated": {
    label: "Updated",
    description: "Triggered when a constant is updated",
    subtitle: "Any change, including publishes and metadata edits.",
  },
  "constant.deleted": {
    label: "Deleted",
    description: "Triggered when a constant is deleted",
  },
  "constant.revision.created": {
    label: "New draft revision",
    description:
      "Triggered when a new draft revision is created for a constant",
  },
  "constant.revision.updated": {
    label: "Draft edited",
    description:
      "Triggered when a draft revision's proposed changes are modified (value, archive, or metadata). The `change` field indicates the kind of mutation.",
    subtitle: "Every edit to a draft.",
  },
  "constant.revision.reviewRequested": {
    label: "Review requested",
    description: "Triggered when a draft revision is submitted for review",
  },
  "constant.revision.approved": {
    label: "Draft approved",
    description: "Triggered when a draft revision is approved by a reviewer",
  },
  "constant.revision.changesRequested": {
    label: "Changes requested",
    description:
      "Triggered when a reviewer requests changes on a draft revision",
  },
  "constant.revision.commented": {
    label: "Comment on draft",
    description: "Triggered when a comment is added to a draft revision",
  },
  "constant.revision.discarded": {
    label: "Draft discarded",
    description: "Triggered when a draft revision is discarded",
  },
  "constant.revision.rebased": {
    label: "Draft rebased",
    description:
      "Triggered when a draft revision is rebased onto the latest live state",
    subtitle: "The draft is moved onto the latest live version.",
  },
  "constant.revision.published": {
    label: "New version published",
    description:
      "Triggered when a draft revision is published. Overlaps with `constant.updated` but provides revision-specific context.",
    subtitle: "A draft becomes the live version.",
  },
  "constant.revision.reverted": {
    label: "Reverted to previous version",
    description:
      "Triggered when a constant is reverted to a previous published revision",
  },
  "constant.revision.reopened": {
    label: "Discarded draft reopened",
    description: "Triggered when a discarded revision is reopened",
  },
  "constant.revision.recalled": {
    label: "Review request withdrawn",
    description:
      "Triggered when the author (or an editor) recalls a review request, returning the revision to `draft`. Distinct from `revision.reopened`, which restores a discarded revision.",
    subtitle: "The author withdraws a review request. The draft stays open.",
  },
  "constant.revision.reviewRetracted": {
    label: "Review retracted",
    description:
      "Triggered when a reviewer retracts their own verdict. The status is recomputed from the verdicts that remain, so the revision may end up `pending-review`, or stay `approved` or `changes-requested` when another reviewer's verdict still stands. Carries no content change — the revision's proposed changes are untouched.",
    subtitle: "A reviewer withdraws their own approval or change request.",
  },
  "constant.revision.publishScheduleChanged": {
    label: "Publish schedule changed",
    description:
      "Triggered when a deferred publish is armed, re-armed, or cancelled on a revision. Carries no content change.",
    subtitle: "A scheduled publish is set, moved, or cancelled.",
  },
  "constant.revision.publishFailed": {
    label: "Scheduled publishing failed",
    description:
      "Triggered when a deferred publish (scheduled publish or auto-publish-on-approval) is given up on after failing — terminally, or after exhausting retries. The draft is left open for a human to resolve.",
    subtitle:
      "A scheduled or automatic publish failed and won't retry. The draft stays open.",
  },
  "config.created": {
    label: "Created",
    description: "Triggered when a config is created",
  },
  "config.updated": {
    label: "Updated",
    description: "Triggered when a config is updated",
    subtitle: "Any change, including publishes and metadata edits.",
  },
  "config.deleted": {
    label: "Deleted",
    description: "Triggered when a config is deleted",
  },
  "config.revision.created": {
    label: "New draft revision",
    description: "Triggered when a new draft revision is created for a config",
  },
  "config.revision.updated": {
    label: "Draft edited",
    description:
      "Triggered when a draft revision's proposed changes are modified (value, schema, archive, or metadata). The `change` field indicates the kind of mutation.",
    subtitle: "Every edit to a draft.",
  },
  "config.revision.reviewRequested": {
    label: "Review requested",
    description: "Triggered when a draft revision is submitted for review",
  },
  "config.revision.approved": {
    label: "Draft approved",
    description: "Triggered when a draft revision is approved by a reviewer",
  },
  "config.revision.changesRequested": {
    label: "Changes requested",
    description:
      "Triggered when a reviewer requests changes on a draft revision",
  },
  "config.revision.commented": {
    label: "Comment on draft",
    description: "Triggered when a comment is added to a draft revision",
  },
  "config.revision.discarded": {
    label: "Draft discarded",
    description: "Triggered when a draft revision is discarded",
  },
  "config.revision.rebased": {
    label: "Draft rebased",
    description:
      "Triggered when a draft revision is rebased onto the latest live state",
    subtitle: "The draft is moved onto the latest live version.",
  },
  "config.revision.published": {
    label: "New version published",
    description:
      "Triggered when a draft revision is published. Overlaps with `config.updated` but provides revision-specific context.",
    subtitle: "A draft becomes the live version.",
  },
  "config.revision.reverted": {
    label: "Reverted to previous version",
    description:
      "Triggered when a config is reverted to a previous published revision",
  },
  "config.revision.reopened": {
    label: "Discarded draft reopened",
    description: "Triggered when a discarded revision is reopened",
  },
  "config.revision.recalled": {
    label: "Review request withdrawn",
    description:
      "Triggered when the author (or an editor) recalls a review request, returning the revision to `draft`. Distinct from `revision.reopened`, which restores a discarded revision.",
    subtitle: "The author withdraws a review request. The draft stays open.",
  },
  "config.revision.reviewRetracted": {
    label: "Review retracted",
    description:
      "Triggered when a reviewer retracts their own verdict. The status is recomputed from the verdicts that remain, so the revision may end up `pending-review`, or stay `approved` or `changes-requested` when another reviewer's verdict still stands. Carries no content change — the revision's proposed changes are untouched.",
    subtitle: "A reviewer withdraws their own approval or change request.",
  },
  "config.revision.publishScheduleChanged": {
    label: "Publish schedule changed",
    description:
      "Triggered when a deferred publish is armed, re-armed, or cancelled on a revision. Carries no content change.",
    subtitle: "A scheduled publish is set, moved, or cancelled.",
  },
  "config.revision.publishFailed": {
    label: "Scheduled publishing failed",
    description:
      "Triggered when a deferred publish (scheduled publish or auto-publish-on-approval) is given up on after failing — terminally, or after exhausting retries. The draft is left open for a human to resolve.",
    subtitle:
      "A scheduled or automatic publish failed and won't retry. The draft stays open.",
  },
  "user.login": {
    label: "User logged in",
    description: "Triggered when a user logs in",
  },
  "webhook.test": {
    label: "Webhook test",
    description: "Triggered when a webhook is being tested",
    internal: true,
  },
} satisfies Record<NotificationEventName, NotificationEventMetadata>;

export type PreviewNotificationEventName = {
  [Name in NotificationEventName]: (typeof notificationEventMetadata)[Name] extends {
    preview: true;
  }
    ? Name
    : never;
}[NotificationEventName];
export type CardNotificationEventName = {
  [Name in NotificationEventName]: (typeof notificationEventMetadata)[Name] extends {
    supportsCard: true;
  }
    ? Name
    : never;
}[NotificationEventName];

const eventNames = Object.keys(
  notificationEventMetadata,
) as NotificationEventName[];
export const publicNotificationEventNames = eventNames.filter((name) => {
  const metadata: NotificationEventMetadata = notificationEventMetadata[name];
  return !metadata.internal;
});
export const previewNotificationEventNames =
  publicNotificationEventNames.filter(
    (name): name is PreviewNotificationEventName =>
      "preview" in notificationEventMetadata[name],
  );
export const cardNotificationEventNames = publicNotificationEventNames.filter(
  (name): name is CardNotificationEventName =>
    "supportsCard" in notificationEventMetadata[name],
);

export const notificationCategories = {
  experiment: "Experiments",
  feature: "Feature Flags",
  savedGroup: "Saved Groups",
  constant: "Constants",
  config: "Configs",
};
export type NotificationEventCategory = keyof typeof notificationCategories;

interface NotificationEventGroup {
  label: string;
  options: (
    | NotificationEventName
    | {
        id: string;
        label: string;
        subtitle?: string;
        events: NotificationEventName[];
      }
  )[];
}

export const notificationCategoryGroups: Record<
  NotificationEventCategory,
  NotificationEventGroup[]
> = {
  experiment: [
    {
      label: "Experiment changes",
      options: [
        "experiment.created",
        "experiment.updated",
        "experiment.deleted",
      ],
    },
    {
      label: "Results & decisions",
      options: [
        "experiment.info.significance",
        {
          id: "exp-decision",
          label: "Decision ready",
          subtitle: "Ready to ship, roll back, or review.",
          events: [
            "experiment.decision.ship",
            "experiment.decision.rollback",
            "experiment.decision.review",
          ],
        },
      ],
    },
    {
      label: "Health & warnings",
      options: ["experiment.warning"],
    },
    {
      label: "Schedules",
      options: ["experiment.info.scheduled-status-update"],
    },
  ],
  feature: [
    {
      label: "Feature changes",
      options: [
        "feature.revision.published",
        "feature.revision.reverted",
        "feature.created",
        "feature.updated",
        "feature.deleted",
      ],
    },
    {
      label: "Safe rollouts",
      options: [
        {
          id: "feat-saferollout",
          label: "Safe rollout outcomes",
          subtitle: "Ready to ship, should roll back, or unhealthy.",
          events: [
            "feature.saferollout.ship",
            "feature.saferollout.rollback",
            "feature.saferollout.unhealthy",
          ],
        },
      ],
    },
    {
      label: "Draft & review",
      options: [
        "feature.revision.created",
        "feature.revision.updated",
        "feature.revision.reviewRequested",
        "feature.revision.approved",
        "feature.revision.changesRequested",
        "feature.revision.commented",
        "feature.revision.discarded",
        "feature.revision.reopened",
        "feature.revision.recalled",
        "feature.revision.reviewRetracted",
        "feature.revision.publishScheduleChanged",
        "feature.revision.rebased",
        "feature.revision.publishFailed",
      ],
    },
    {
      label: "Schedules",
      options: [
        {
          id: "feat-ramp",
          label: "Ramp schedule activity",
          subtitle:
            "Ramp schedule created, advanced, completed, or rolled back.",
          events: [
            "feature.rampSchedule.created",
            "feature.rampSchedule.deleted",
            "feature.rampSchedule.actions.started",
            "feature.rampSchedule.actions.completed",
            "feature.rampSchedule.actions.rolledBack",
            "feature.rampSchedule.actions.jumped",
            "feature.rampSchedule.actions.step.advanced",
            "feature.rampSchedule.actions.step.approvalRequired",
            "feature.rampSchedule.actions.awaitingStartApproval",
            "feature.rampSchedule.actions.startApproved",
            "feature.rampSchedule.actions.errorPaused",
          ],
        },
      ],
    },
  ],
  savedGroup: [
    {
      label: "Saved Group changes",
      options: [
        "savedGroup.revision.published",
        "savedGroup.revision.reverted",
        "savedGroup.created",
        "savedGroup.updated",
        "savedGroup.deleted",
      ],
    },
    {
      label: "Draft & review",
      options: [
        "savedGroup.revision.created",
        "savedGroup.revision.updated",
        "savedGroup.revision.reviewRequested",
        "savedGroup.revision.approved",
        "savedGroup.revision.changesRequested",
        "savedGroup.revision.commented",
        "savedGroup.revision.discarded",
        "savedGroup.revision.reopened",
        "savedGroup.revision.recalled",
        "savedGroup.revision.reviewRetracted",
        "savedGroup.revision.publishScheduleChanged",
        "savedGroup.revision.rebased",
        "savedGroup.revision.publishFailed",
      ],
    },
  ],
  constant: [
    {
      label: "Constant changes",
      options: [
        "constant.revision.published",
        "constant.revision.reverted",
        "constant.created",
        "constant.updated",
        "constant.deleted",
      ],
    },
    {
      label: "Draft & review",
      options: [
        "constant.revision.created",
        "constant.revision.updated",
        "constant.revision.reviewRequested",
        "constant.revision.approved",
        "constant.revision.changesRequested",
        "constant.revision.commented",
        "constant.revision.discarded",
        "constant.revision.reopened",
        "constant.revision.recalled",
        "constant.revision.reviewRetracted",
        "constant.revision.publishScheduleChanged",
        "constant.revision.rebased",
        "constant.revision.publishFailed",
      ],
    },
  ],
  config: [
    {
      label: "Config changes",
      options: [
        "config.revision.published",
        "config.revision.reverted",
        "config.created",
        "config.updated",
        "config.deleted",
      ],
    },
    {
      label: "Draft & review",
      options: [
        "config.revision.created",
        "config.revision.updated",
        "config.revision.reviewRequested",
        "config.revision.approved",
        "config.revision.changesRequested",
        "config.revision.commented",
        "config.revision.discarded",
        "config.revision.reopened",
        "config.revision.recalled",
        "config.revision.reviewRetracted",
        "config.revision.publishScheduleChanged",
        "config.revision.rebased",
        "config.revision.publishFailed",
      ],
    },
  ],
};

export interface NotificationEventOption {
  id: string;
  label: string;
  subtitle?: string;
  category: NotificationEventCategory;
  group: string;
  // All controlled events must be selected for the option to read as on.
  events: NotificationEventName[];
}

export const notificationEventOptions: NotificationEventOption[] = (
  Object.keys(notificationCategoryGroups) as NotificationEventCategory[]
).flatMap((category) =>
  notificationCategoryGroups[category].flatMap((group) =>
    group.options.flatMap((option): NotificationEventOption[] => {
      const controlled = typeof option === "string" ? [option] : option.events;
      const events = controlled.filter((event) =>
        publicNotificationEventNames.includes(event),
      );
      if (!events.length) return [];
      if (typeof option !== "string") {
        return [{ ...option, category, group: group.label, events }];
      }
      const metadata: NotificationEventMetadata =
        notificationEventMetadata[option];
      return [
        {
          id: option,
          label: metadata.label,
          subtitle: metadata.subtitle,
          category,
          group: group.label,
          events,
        },
      ];
    }),
  ),
);

export type NotificationLevel = "default" | "all" | "custom";
const eventsInCategory = (category: NotificationEventCategory) =>
  notificationEventOptions
    .filter((option) => option.category === category)
    .flatMap((option) => option.events);

export const notificationCategoryPresets: Record<
  NotificationEventCategory,
  Record<Exclude<NotificationLevel, "custom">, NotificationEventName[]>
> = {
  experiment: {
    default: [
      "experiment.decision.ship",
      "experiment.decision.rollback",
      "experiment.decision.review",
      "experiment.warning",
    ],
    all: eventsInCategory("experiment"),
  },
  feature: {
    default: [
      "feature.revision.published",
      "feature.revision.reverted",
      "feature.saferollout.ship",
      "feature.saferollout.rollback",
      "feature.saferollout.unhealthy",
      "feature.revision.reviewRequested",
      "feature.revision.changesRequested",
    ],
    all: eventsInCategory("feature"),
  },
  savedGroup: {
    default: ["savedGroup.revision.published"],
    all: eventsInCategory("savedGroup"),
  },
  constant: {
    default: ["constant.revision.published"],
    all: eventsInCategory("constant"),
  },
  config: {
    default: ["config.revision.published"],
    all: eventsInCategory("config"),
  },
};

export const initiallyEnabledNotificationCategories = [
  "experiment",
  "feature",
] satisfies NotificationEventCategory[];
export const defaultSlackNotificationEvents =
  initiallyEnabledNotificationCategories.flatMap(
    (category) => notificationCategoryPresets[category].default,
  );

export function notificationEventsForLevel(
  category: NotificationEventCategory,
  level: Exclude<NotificationLevel, "custom">,
): NotificationEventName[] {
  return [...notificationCategoryPresets[category][level]];
}

export function matchesNotificationEvent(
  subscription: string,
  event: string,
): boolean {
  return (
    subscription === event ||
    (subscription.endsWith(".*") && event.startsWith(subscription.slice(0, -1)))
  );
}

export function hasNotificationWildcard(
  events: string[],
  category: NotificationEventCategory,
): boolean {
  return events.some(
    (event) => event.startsWith(`${category}.`) && event.endsWith(".*"),
  );
}

export function notificationEventSelection(
  events: string[],
  controlled: string[],
): boolean | "indeterminate" {
  const count = controlled.filter((event) =>
    events.some((subscription) =>
      matchesNotificationEvent(subscription, event),
    ),
  ).length;
  return count === 0
    ? false
    : count === controlled.length
      ? true
      : "indeterminate";
}

// Expand only wildcards affected by this edit. Unrelated subscriptions, including
// unknown explicit event names, survive unchanged. Merely opening/saving does not
// normalize wildcards or broaden partially selected groups.
export function toggleNotificationEvents(
  events: string[],
  controlled: string[],
  enabled: boolean,
): string[] {
  if (enabled)
    return [
      ...new Set([
        ...events,
        ...controlled.filter(
          (event) =>
            !events.some((subscription) =>
              matchesNotificationEvent(subscription, event),
            ),
        ),
      ]),
    ];
  const removed = new Set(controlled);
  return [
    ...new Set(
      events.flatMap((subscription) => {
        if (
          !controlled.some((event) =>
            matchesNotificationEvent(subscription, event),
          )
        )
          return [subscription];
        if (!subscription.endsWith(".*")) return [];
        return publicNotificationEventNames.filter(
          (event) =>
            matchesNotificationEvent(subscription, event) &&
            !removed.has(event),
        );
      }),
    ),
  ];
}

export function getNotificationLevel(
  events: string[],
  category: NotificationEventCategory,
): NotificationLevel {
  const subscriptions = events.filter((event) =>
    event.startsWith(`${category}.`),
  );
  // The resource wildcard is "all" plus future events; narrower wildcards stay custom.
  if (subscriptions.includes(`${category}.*`)) return "all";
  if (subscriptions.some((event) => event.endsWith(".*"))) return "custom";
  for (const level of ["default", "all"] as const) {
    const preset = notificationEventsForLevel(category, level);
    if (
      subscriptions.length > 0 &&
      preset.length === new Set(subscriptions).size &&
      preset.every((event) => subscriptions.includes(event))
    )
      return level;
  }
  return "custom";
}
export function applyNotificationLevel(
  events: string[],
  category: NotificationEventCategory,
  level: Exclude<NotificationLevel, "custom">,
): string[] {
  return [
    ...events.filter((event) => !event.startsWith(`${category}.`)),
    ...notificationEventsForLevel(category, level),
  ];
}
