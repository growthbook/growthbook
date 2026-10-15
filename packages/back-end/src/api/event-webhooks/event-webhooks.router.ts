import { OpenApiRoute } from "back-end/src/util/handler";
import {
  deleteEventWebhook,
  getEventWebhook,
  listEventWebhookLogs,
  listEventWebhooks,
  postEventWebhook,
  postEventWebhookTest,
  putEventWebhook,
} from "./eventWebhooks";

export const eventWebhooksRoutes: OpenApiRoute[] = [
  listEventWebhooks,
  postEventWebhook,
  getEventWebhook,
  putEventWebhook,
  deleteEventWebhook,
  listEventWebhookLogs,
  postEventWebhookTest,
];
