import {
  NotificationEvent,
  LegacyNotificationEvent,
} from "shared/types/events/notification-events";

export const getLegacyMessageForNotificationEvent = (
  event: NotificationEvent,
): LegacyNotificationEvent | undefined => {
  const { user, projects, tags, environments, containsSecrets } = event;

  const attributes = { user, projects, tags, environments, containsSecrets };

  switch (event.event) {
    case "user.login":
      return {
        object: event.object,
        event: event.event,
        data: { current: event.data.object },
        ...attributes,
      };
    case "webhook.test":
      return {
        object: event.object,
        event: event.event,
        data: event.data.object,
        ...attributes,
      };
    case "experiment.warning":
      return {
        object: event.object,
        event: event.event,
        data: event.data.object,
        ...attributes,
      };
    case "feature.created":
      return {
        object: event.object,
        event: event.event,
        data: { current: event.data.object },
        ...attributes,
      };
    case "experiment.created":
      return {
        object: event.object,
        event: event.event,
        data: { current: event.data.object },
        ...attributes,
      };
    case "feature.updated":
      return {
        object: event.object,
        event: event.event,
        data: {
          current: event.data.object,
          previous: { ...event.data.object, ...event.data.previous_attributes },
        },
        ...attributes,
      };
    case "experiment.updated":
      return {
        object: event.object,
        event: event.event,
        data: {
          current: event.data.object,
          previous: { ...event.data.object, ...event.data.previous_attributes },
        },
        ...attributes,
      };
    case "feature.deleted":
      return {
        object: event.object,
        event: event.event,
        data: { previous: event.data.object },
        ...attributes,
      };
    case "experiment.deleted":
      return {
        object: event.object,
        event: event.event,
        data: { previous: event.data.object },
        ...attributes,
      };

    case "feature.saferollout.ship":
    case "feature.saferollout.rollback":
    case "feature.saferollout.unhealthy":
    case "feature.rampSchedule.created":
    case "feature.rampSchedule.deleted":
    case "feature.rampSchedule.actions.started":
    case "feature.rampSchedule.actions.completed":
    case "feature.rampSchedule.actions.rolledBack":
    case "feature.rampSchedule.actions.jumped":
    case "feature.rampSchedule.actions.step.advanced":
    case "feature.rampSchedule.actions.step.approvalRequired":
    case "feature.rampSchedule.actions.awaitingStartApproval":
    case "feature.rampSchedule.actions.startApproved":
    case "feature.revision.created":
    case "feature.revision.updated":
    case "feature.revision.reviewRequested":
    case "feature.revision.approved":
    case "feature.revision.changesRequested":
    case "feature.revision.commented":
    case "feature.revision.discarded":
    case "feature.revision.reopened":
    case "feature.revision.recalled":
    case "feature.revision.reviewRetracted":
    case "feature.revision.publishScheduleChanged":
    case "feature.revision.rebased":
    case "feature.revision.published":
    case "feature.revision.reverted":
    case "feature.revision.publishFailed":
    case "experiment.info.significance":
    case "experiment.info.scheduled-status-update":
    case "experiment.decision.ship":
    case "experiment.decision.rollback":
    case "experiment.decision.review":
    case "savedGroup.created":
    case "savedGroup.updated":
    case "savedGroup.deleted":
    case "savedGroup.revision.created":
    case "savedGroup.revision.updated":
    case "savedGroup.revision.reviewRequested":
    case "savedGroup.revision.approved":
    case "savedGroup.revision.changesRequested":
    case "savedGroup.revision.commented":
    case "savedGroup.revision.discarded":
    case "savedGroup.revision.rebased":
    case "savedGroup.revision.published":
    case "savedGroup.revision.reverted":
    case "savedGroup.revision.reopened":
    case "savedGroup.revision.recalled":
    case "savedGroup.revision.reviewRetracted":
    case "savedGroup.revision.publishScheduleChanged":
    case "savedGroup.revision.publishFailed":
    case "constant.created":
    case "constant.updated":
    case "constant.deleted":
    case "constant.revision.created":
    case "constant.revision.updated":
    case "constant.revision.reviewRequested":
    case "constant.revision.approved":
    case "constant.revision.changesRequested":
    case "constant.revision.commented":
    case "constant.revision.discarded":
    case "constant.revision.rebased":
    case "constant.revision.published":
    case "constant.revision.reverted":
    case "constant.revision.reopened":
    case "constant.revision.recalled":
    case "constant.revision.reviewRetracted":
    case "constant.revision.publishScheduleChanged":
    case "constant.revision.publishFailed":
    case "config.created":
    case "config.updated":
    case "config.deleted":
    case "config.revision.created":
    case "config.revision.updated":
    case "config.revision.reviewRequested":
    case "config.revision.approved":
    case "config.revision.changesRequested":
    case "config.revision.commented":
    case "config.revision.discarded":
    case "config.revision.rebased":
    case "config.revision.published":
    case "config.revision.reverted":
    case "config.revision.reopened":
    case "config.revision.recalled":
    case "config.revision.reviewRetracted":
    case "config.revision.publishScheduleChanged":
    case "config.revision.publishFailed":
      return;
  }
};
