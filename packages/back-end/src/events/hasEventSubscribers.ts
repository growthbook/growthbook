import { getAllEventWebHooksForEvent } from "back-end/src/models/EventWebhookModel";
import { getSlackIntegrationsForFilters } from "back-end/src/models/SlackIntegrationModel";
import { logger } from "back-end/src/util/logger";
import {
  filterEventForEnvironments,
  webhookTakesEvent,
} from "./handlers/utils";

export async function hasEventSubscribers({
  environments,
  ...filters
}: Omit<Parameters<typeof getAllEventWebHooksForEvent>[0], "enabled"> & {
  environments: string[];
}): Promise<boolean> {
  try {
    const [webhooks, slackIntegrations] = await Promise.all([
      getAllEventWebHooksForEvent({ ...filters, enabled: true }),
      getSlackIntegrationsForFilters(filters),
    ]);

    // A failed legacy Slack lookup returns null. Keep dispatching if uncertain.
    if (slackIntegrations === null) return true;

    return (
      webhooks.some((webhook) =>
        webhookTakesEvent(webhook, { event: filters.eventName, environments }),
      ) ||
      slackIntegrations.some((integration) =>
        filterEventForEnvironments({
          event: { environments },
          environments: integration.environments || [],
        }),
      )
    );
  } catch (error) {
    logger.error(
      error,
      "Could not check event subscriptions; keeping dispatch",
    );
    return true;
  }
}
