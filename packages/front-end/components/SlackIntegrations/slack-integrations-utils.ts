import { NotificationEventName } from "back-end/src/events/base-types";

export type SlackIntegrationEditParams = {
  name: string;
  description: string;
  project: string | null;
  environments: string[];
  events: NotificationEventName[];
  tags: string[];
  slackAppId: string;
  slackSigningKey: string;
};
