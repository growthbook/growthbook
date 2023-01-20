import { NotificationEventName } from "back-end/src/events/base-types";

export type SlackIntegrationEditParams = {
  name: string;
  description: string;
  projects: string[];
  environments: string[];
  events: NotificationEventName[];
  tags: string[];
  slackAppId: string;
  slackSigningKey: string;
  slackIncomingWebHook: string;
};

export type SlackIntegrationModalMode =
  | {
      mode: "create";
    }
  | {
      mode: "edit";
      id: string;
      data: SlackIntegrationEditParams;
    };
