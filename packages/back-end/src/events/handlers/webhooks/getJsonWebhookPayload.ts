import { EventWebHookApiVersion } from "shared/validators";
import { NotificationEvent } from "shared/types/events/base-types";

// Adapt the stored event to the receiver's API version and selected result.
export function getJsonWebhookPayload(
  event: NotificationEvent,
  apiVersion: EventWebHookApiVersion,
  changeIndex = 0,
): Record<string, unknown> {
  const payload = { ...event, api_version: apiVersion };
  if (event.event !== "experiment.info.significance") return payload;

  const data = event.data.object;
  // Events created before aggregation keep their original payload and version.
  if (!("changes" in data)) return event;
  if (apiVersion === "2026-09-11") return payload;

  return {
    ...payload,
    data: {
      object: {
        experimentId: data.experimentId,
        experimentName: data.experimentName,
        ...data.changes[changeIndex],
      },
    },
  };
}
