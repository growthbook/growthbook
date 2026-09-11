import { notificationEventNames, notificationEvents } from "shared/validators";

export type SlackEventCategory = "experiment" | "feature";

export interface SlackEventOption {
  id: string;
  label: string;
  description?: string;
  category: SlackEventCategory;
  group: string;
  // Concrete events this option controls; all must be subscribed to read as "on".
  events: string[];
  // Part of the curated default subscription / simple-toggle preset.
  defaultOn: boolean;
}

const originalOptions: SlackEventOption[] = [
  {
    id: "exp-started",
    label: "Experiment started",
    category: "experiment",
    group: "Lifecycle",
    events: ["experiment.started"],
    defaultOn: true,
  },
  {
    id: "exp-stopped",
    label: "Experiment stopped",
    description:
      "When an experiment stops, including its result and any temporary rollout.",
    category: "experiment",
    group: "Lifecycle",
    events: ["experiment.stopped"],
    defaultOn: true,
  },
  {
    id: "exp-created",
    label: "New experiment (draft)",
    description: "When an experiment is first created, before it starts.",
    category: "experiment",
    group: "Lifecycle",
    events: ["experiment.created"],
    defaultOn: false,
  },
  {
    id: "exp-updated",
    label: "Experiment edited",
    description: "Metadata, targeting, or variation changes.",
    category: "experiment",
    group: "Lifecycle",
    events: ["experiment.updated"],
    defaultOn: false,
  },
  {
    id: "exp-status-changed",
    label: "Status changed",
    category: "experiment",
    group: "Lifecycle",
    events: ["experiment.status.changed"],
    defaultOn: false,
  },
  {
    id: "exp-deleted",
    label: "Experiment deleted",
    category: "experiment",
    group: "Lifecycle",
    events: ["experiment.deleted"],
    defaultOn: false,
  },
  {
    id: "exp-ending-soon",
    label: "Ending soon",
    category: "experiment",
    group: "Lifecycle",
    events: ["experiment.endingSoon"],
    defaultOn: false,
  },
  {
    id: "exp-stale",
    label: "Stale (no decision)",
    category: "experiment",
    group: "Lifecycle",
    events: ["experiment.stale"],
    defaultOn: false,
  },
  {
    id: "exp-significance",
    label: "Reached significance",
    category: "experiment",
    group: "Results & decisions",
    events: ["experiment.info.significance"],
    defaultOn: false,
  },
  {
    id: "exp-decision",
    label: "Decision ready",
    description: "Ready to ship, roll back, or review.",
    category: "experiment",
    group: "Results & decisions",
    events: [
      "experiment.decision.ship",
      "experiment.decision.rollback",
      "experiment.decision.review",
    ],
    defaultOn: true,
  },
  {
    id: "exp-metric-regression",
    label: "Metric regression",
    category: "experiment",
    group: "Results & decisions",
    events: ["experiment.metric.regression"],
    defaultOn: true,
  },
  {
    id: "exp-warning",
    label: "Warnings",
    description: "SRM, multiple exposures, and other warning conditions.",
    category: "experiment",
    group: "Health & warnings",
    events: ["experiment.warning"],
    defaultOn: true,
  },
  {
    id: "exp-guardrail-failed",
    label: "Guardrail failed",
    category: "experiment",
    group: "Health & warnings",
    events: ["experiment.health.guardrailFailed"],
    defaultOn: true,
  },
  {
    id: "exp-no-data",
    label: "No data",
    category: "experiment",
    group: "Health & warnings",
    events: ["experiment.health.noData"],
    defaultOn: false,
  },
  {
    id: "exp-query-failed",
    label: "Query failed",
    category: "experiment",
    group: "Health & warnings",
    events: ["experiment.health.queryFailed"],
    defaultOn: false,
  },
  {
    id: "exp-bandit",
    label: "Bandit weights changed",
    category: "experiment",
    group: "Advanced",
    events: ["experiment.bandit.weightsChanged"],
    defaultOn: false,
  },
  {
    id: "exp-holdout",
    label: "Holdout created / updated",
    category: "experiment",
    group: "Advanced",
    events: ["experiment.holdout.created", "experiment.holdout.updated"],
    defaultOn: false,
  },
  {
    id: "feat-published",
    label: "New version published",
    description: "A draft revision is published live.",
    category: "feature",
    group: "Feature changes",
    events: ["feature.revision.published"],
    defaultOn: true,
  },
  {
    id: "feat-reverted",
    label: "Reverted to previous version",
    category: "feature",
    group: "Feature changes",
    events: ["feature.revision.reverted"],
    defaultOn: true,
  },
  {
    id: "feat-created",
    label: "Feature created",
    category: "feature",
    group: "Feature changes",
    events: ["feature.created"],
    defaultOn: false,
  },
  {
    id: "feat-updated",
    label: "Feature updated",
    category: "feature",
    group: "Feature changes",
    events: ["feature.updated"],
    defaultOn: false,
  },
  {
    id: "feat-deleted",
    label: "Feature deleted",
    category: "feature",
    group: "Feature changes",
    events: ["feature.deleted"],
    defaultOn: false,
  },
  {
    id: "feat-saferollout",
    label: "Safe rollout outcomes",
    description: "Ready to ship, should roll back, or unhealthy.",
    category: "feature",
    group: "Safe rollouts",
    events: [
      "feature.saferollout.ship",
      "feature.saferollout.rollback",
      "feature.saferollout.unhealthy",
    ],
    defaultOn: true,
  },
  {
    id: "feat-revision-created",
    label: "New draft revision",
    category: "feature",
    group: "Drafts & review",
    events: ["feature.revision.created"],
    defaultOn: false,
  },
  {
    id: "feat-revision-updated",
    label: "Draft edited",
    category: "feature",
    group: "Drafts & review",
    events: ["feature.revision.updated"],
    defaultOn: false,
  },
  {
    id: "feat-review-requested",
    label: "Review requested",
    category: "feature",
    group: "Drafts & review",
    events: ["feature.revision.reviewRequested"],
    defaultOn: true,
  },
  {
    id: "feat-review-approved",
    label: "Draft approved",
    category: "feature",
    group: "Drafts & review",
    events: ["feature.revision.approved"],
    defaultOn: false,
  },
  {
    id: "feat-changes-requested",
    label: "Changes requested",
    category: "feature",
    group: "Drafts & review",
    events: ["feature.revision.changesRequested"],
    defaultOn: true,
  },
  {
    id: "feat-revision-commented",
    label: "Comment on draft",
    category: "feature",
    group: "Drafts & review",
    events: ["feature.revision.commented"],
    defaultOn: false,
  },
  {
    id: "feat-revision-discarded",
    label: "Draft discarded",
    category: "feature",
    group: "Drafts & review",
    events: ["feature.revision.discarded"],
    defaultOn: false,
  },
  {
    id: "feat-ramp",
    label: "Ramp schedule activity",
    description: "Ramp schedule created, advanced, completed, or rolled back.",
    category: "feature",
    group: "Advanced",
    events: [
      "feature.rampSchedule.created",
      "feature.rampSchedule.deleted",
      "feature.rampSchedule.actions.started",
      "feature.rampSchedule.actions.completed",
      "feature.rampSchedule.actions.rolledBack",
      "feature.rampSchedule.actions.jumped",
      "feature.rampSchedule.actions.step.advanced",
      "feature.rampSchedule.actions.step.approvalRequired",
    ],
    defaultOn: false,
  },
  {
    id: "feat-stale",
    label: "Stale flag candidate",
    category: "feature",
    group: "Advanced",
    events: ["feature.stale.candidate"],
    defaultOn: false,
  },
];

const availableEvents = notificationEventNames.filter((name) => {
  const [resource, ...parts] = name.split(".");
  const definitions: Record<
    string,
    Record<string, { description: string; noDoc?: boolean }>
  > = notificationEvents;
  return !definitions[resource]?.[parts.join(".")]?.noDoc;
});
const available = new Set<string>(availableEvents);

// Use the original presentation catalog, but only offer events in this stack.
export const slackEventOptions = originalOptions
  .map((option) => ({
    ...option,
    events: option.events.filter((event) => available.has(event)),
  }))
  .filter((option) => option.events.length > 0);

const catalogEvents = new Set(
  slackEventOptions.flatMap((option) => option.events),
);
for (const category of ["experiment", "feature"] as const) {
  for (const event of availableEvents.filter(
    (event) => event.startsWith(`${category}.`) && !catalogEvents.has(event),
  )) {
    const name = event.slice(category.length + 1);
    const definitions: Record<
      string,
      Record<string, { description: string }>
    > = notificationEvents;
    const words = name
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[.-]/g, " ")
      .toLowerCase();
    slackEventOptions.push({
      id: event,
      category,
      group: "Other events",
      label: words.charAt(0).toUpperCase() + words.slice(1),
      description: definitions[category][name].description,
      events: [event],
      defaultOn: false,
    });
  }
}

export function matchesSlackEvent(
  subscription: string,
  event: string,
): boolean {
  return (
    subscription === event ||
    (subscription.endsWith(".*") && event.startsWith(subscription.slice(0, -1)))
  );
}

export function slackEventSelection(
  events: string[],
  controlled: string[],
): boolean | "indeterminate" {
  const count = controlled.filter((event) =>
    events.some((subscription) => matchesSlackEvent(subscription, event)),
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
export function toggleSlackEvents(
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
              matchesSlackEvent(subscription, event),
            ),
        ),
      ]),
    ];
  const removed = new Set(controlled);
  return [
    ...new Set(
      events.flatMap((subscription) => {
        if (!controlled.some((event) => matchesSlackEvent(subscription, event)))
          return [subscription];
        if (!subscription.endsWith(".*")) return [];
        return availableEvents.filter(
          (event) =>
            matchesSlackEvent(subscription, event) && !removed.has(event),
        );
      }),
    ),
  ];
}

export type SlackNotificationLevel =
  | "important"
  | "default"
  | "full"
  | "custom";
export function slackEventsForLevel(
  category: SlackEventCategory,
  level: Exclude<SlackNotificationLevel, "custom">,
): string[] {
  return [
    ...new Set(
      slackEventOptions
        .filter(
          (option) =>
            option.category === category &&
            (level === "full" ||
              (level === "default"
                ? option.defaultOn
                : category === "experiment"
                  ? ["Results & decisions", "Health & warnings"].includes(
                      option.group,
                    )
                  : option.group === "Safe rollouts" ||
                    option.events.includes("feature.revision.published"))),
        )
        .flatMap((option) => option.events),
    ),
  ];
}
export function slackNotificationLevel(
  events: string[],
  category: SlackEventCategory,
): SlackNotificationLevel {
  const subscriptions = events.filter((event) =>
    event.startsWith(`${category}.`),
  );
  // Keep wildcard subscriptions visibly custom: future events are also included.
  if (subscriptions.some((event) => event.endsWith(".*"))) return "custom";
  for (const level of ["default", "important", "full"] as const) {
    const preset = slackEventsForLevel(category, level);
    if (
      subscriptions.length > 0 &&
      preset.length === new Set(subscriptions).size &&
      preset.every((event) => subscriptions.includes(event))
    )
      return level;
  }
  return "custom";
}
export function applySlackNotificationLevel(
  events: string[],
  category: SlackEventCategory,
  level: Exclude<SlackNotificationLevel, "custom">,
): string[] {
  return [
    ...events.filter((event) => !event.startsWith(`${category}.`)),
    ...slackEventsForLevel(category, level),
  ];
}
