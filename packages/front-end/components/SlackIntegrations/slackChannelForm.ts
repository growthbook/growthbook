import { UseFormReturn } from "react-hook-form";
import { SlackOAuthIntegrationInterface } from "shared/types/slack-integration";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NotificationSettings,
  SlackNotificationSettingsBody,
} from "shared/validators";

export type SlackChannelFormValues = SlackNotificationSettingsBody & {
  notificationSettings: NotificationSettings;
};

export function getSlackChannelFormValues(
  channel: SlackOAuthIntegrationInterface | null,
): SlackChannelFormValues {
  return {
    enabled: channel?.enabled ?? true,
    events: channel?.events ?? [],
    projects: channel?.projects ?? [],
    environments: channel?.environments ?? [],
    tags: channel?.tags ?? [],
    experiments: channel?.experiments,
    features: channel?.features,
    metrics: channel?.metrics,
    excludeBookkeepingUpdates: channel?.excludeBookkeepingUpdates,
    notificationSettings:
      channel?.notificationSettings ?? DEFAULT_NOTIFICATION_SETTINGS,
  };
}

export function acknowledgeSlackChannelSave(
  form: Pick<UseFormReturn<SlackChannelFormValues>, "getValues" | "reset">,
  submitted: SlackChannelFormValues,
) {
  const current = form.getValues();
  // Advance the baseline, then compare edits made during the request with it.
  form.reset(submitted);
  form.reset(current, { keepDefaultValues: true });
}
