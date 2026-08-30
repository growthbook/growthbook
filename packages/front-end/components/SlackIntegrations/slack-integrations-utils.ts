import { NotificationEventNameOrWildcard } from "shared/validators";

export type SlackIntegrationEditParams = {
  name: string;
  description: string;
  projects: string[];
  environments: string[];
  events: NotificationEventNameOrWildcard[];
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
